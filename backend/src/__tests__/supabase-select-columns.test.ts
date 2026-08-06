import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

/**
 * Guards the one class of error TypeScript structurally cannot see.
 *
 * `supabase.from('clients').select('id, name, is_active')` is a plain string.
 * tsc checks nothing inside it, so a column that does not exist compiles, passes
 * every mocked route test, and fails only as a 500 in production against the
 * real database. That is exactly how `/agents` shipped selecting
 * `clients.is_active` — a column that lives on `users`.
 *
 * This reads the schema out of the migrations and the select strings out of the
 * route files, and fails when they disagree.
 */

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '../../../supabase/migrations');
const routesDir = resolve(here, '../dashboard-api');

/** table/view name → set of column names, accumulated across all migrations. */
function schemaFromMigrations(): Map<string, Set<string>> {
  const schema = new Map<string, Set<string>>();
  const add = (table: string, column: string) => {
    if (!schema.has(table)) schema.set(table, new Set());
    schema.get(table)!.add(column);
  };

  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');

    // CREATE TABLE [IF NOT EXISTS] name ( ...column definitions... );
    for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)\s*\(([\s\S]*?)\n\);/g)) {
      const [, table, body] = m;
      for (const line of body.split('\n')) {
        const col = line.match(/^\s{2,}(\w+)\s+[A-Za-z]/);
        // Skip table-level constraints, which also start with a word.
        if (col && !/^\s*(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)\b/i.test(line)) {
          add(table, col[1]);
        }
      }
    }

    // ALTER TABLE name ADD COLUMN [IF NOT EXISTS] col
    for (const m of sql.matchAll(/ALTER TABLE (\w+)\s+ADD COLUMN (?:IF NOT EXISTS )?(\w+)/gi)) {
      add(m[1], m[2]);
    }

    // CREATE [OR REPLACE] VIEW name AS SELECT … — take the aliases/identifiers
    // the view exposes. Deliberately loose: a false positive here would make the
    // test nag, so anything ambiguous is simply admitted.
    for (const m of sql.matchAll(/CREATE (?:OR REPLACE )?VIEW (\w+) AS([\s\S]*?);/g)) {
      const [, view, body] = m;
      for (const alias of body.matchAll(/\bAS\s+(\w+)\s*[,\n]/g)) add(view, alias[1]);
      for (const bare of body.matchAll(/^\s{4}(\w+),/gm)) add(view, bare[1]);
      for (const qualified of body.matchAll(/\b\w+\.(\w+)\s*[,\n]/g)) add(view, qualified[1]);
    }
  }

  return schema;
}

/** Every `.from('table')…select('cols')` pair we can attribute confidently. */
function selectsFromRoutes(): Array<{ file: string; table: string; columns: string[] }> {
  const found: Array<{ file: string; table: string; columns: string[] }> = [];

  for (const file of readdirSync(routesDir).filter((f) => f.endsWith('.ts'))) {
    const text = readFileSync(join(routesDir, file), 'utf8');

    // from('table') followed, within a short window, by select(...). Capture the
    // whole argument, not just the first quoted run: these selects are often
    // written as concatenated literals across lines, e.g.
    //     .select('id, name, ' +
    //             'status, phone_numbers')
    // Matching only the first literal was why the original version of this test
    // passed while `clients.is_active` was still in the second half of one.
    for (const m of text.matchAll(/\.from\('(\w+)'\)[\s\S]{0,400}?\.select\(([\s\S]*?)\)\s*(?:\.|;|,|$)/g)) {
      const [, table, arg] = m;
      // Only the FIRST argument. `.select('client_id', { count: 'exact' })`
      // passes an options object second, and blindly concatenating every
      // literal in the call turned that into the column `client_idexact`.
      const firstArg = arg.match(/^\s*((?:(['`])[\s\S]*?\2\s*\+?\s*)+)/)?.[1] ?? '';
      const raw = [...firstArg.matchAll(/(['`])([\s\S]*?)\1/g)].map((s) => s[2]).join('');
      if (!raw || raw.includes('*')) continue; // nothing to check
      const columns = raw
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean)
        // Drop PostgREST embedded resources like `permissions(permission)` and
        // any aliasing syntax — those follow different rules.
        .filter((c) => !c.includes('(') && !c.includes(':'))
        .map((c) => c.replace(/\s+/g, ''));
      if (columns.length > 0) found.push({ file, table, columns });
    }
  }

  return found;
}

const schema = schemaFromMigrations();
const selects = selectsFromRoutes();

describe('supabase select columns match the schema', () => {
  it('parsed a schema out of the migrations', () => {
    expect(schema.get('clients')?.has('status')).toBe(true);
    expect(schema.get('users')?.has('is_active')).toBe(true);
    // Columns added by later migrations must be picked up too.
    expect(schema.get('clients')?.has('agent_sync_state')).toBe(true);
    expect(schema.get('ticket_messages')?.has('visibility')).toBe(true);
  });

  it('found select statements to check', () => {
    expect(selects.length).toBeGreaterThan(5);
  });

  it('every selected column exists on the table it is selected from', () => {
    const problems: string[] = [];

    for (const { file, table, columns } of selects) {
      const known = schema.get(table);
      if (!known) continue; // table not declared in a migration — nothing to assert
      for (const column of columns) {
        if (!known.has(column)) problems.push(`${file}: ${table}.${column} does not exist`);
      }
    }

    expect(problems).toEqual([]);
  });

  it('specifically rejects clients.is_active, the column that shipped broken', () => {
    // clients has `status`; `is_active` is on users. Keeping this named case
    // means the regression is legible even if the general check is ever relaxed.
    expect(schema.get('clients')!.has('is_active')).toBe(false);
    expect(schema.get('users')!.has('is_active')).toBe(true);
  });
});
