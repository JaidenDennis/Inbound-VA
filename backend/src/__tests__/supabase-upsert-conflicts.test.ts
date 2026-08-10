import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

/**
 * Sibling of supabase-select-columns.test.ts, guarding the other string-typed
 * hole in the Supabase client.
 *
 * `.upsert(row, { onConflict: 'call_id' })` compiles no matter what, but
 * Postgres resolves the ON CONFLICT target at PLAN time and raises 42P10
 * ("there is no unique or exclusion constraint matching the ON CONFLICT
 * specification") when no unique index covers exactly those columns. tsc sees
 * nothing, mocked route tests see nothing, and it fails only against the real
 * database.
 *
 * That is precisely how transcripts went missing: `call_summaries`,
 * `call_transcripts` and `conversations` were created in 001 with PLAIN indexes
 * on call_id, while three call sites upserted onConflict:'call_id'. The
 * call_analyzed webhook arrived, wrote its call_record, then threw 42P10 at
 * upsertSummary — killing the transcript enqueue, the CRM push and the event
 * publish that came after it. 41 call_records, 0 transcripts, 0 summaries, and
 * not one error anybody looked at.
 *
 * This reads the unique constraints out of the migrations and the onConflict
 * targets out of the source, and fails when they disagree.
 */

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '../../../supabase/migrations');
const srcDir = resolve(here, '..');

const norm = (cols: string) =>
  cols
    .split(',')
    .map((c) => c.trim().replace(/["`]/g, ''))
    .filter(Boolean)
    .sort()
    .join(',');

/** table → set of normalized unique-column-tuples declared anywhere in migrations. */
function uniqueKeysFromMigrations(): Map<string, Set<string>> {
  const keys = new Map<string, Set<string>>();
  const add = (table: string, cols: string) => {
    if (!cols.trim()) return;
    if (!keys.has(table)) keys.set(table, new Set());
    keys.get(table)!.add(norm(cols));
  };

  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');

    // CREATE [UNIQUE] INDEX [IF NOT EXISTS] name ON table [USING x] (cols)
    for (const m of sql.matchAll(
      /CREATE\s+UNIQUE\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF NOT EXISTS\s+)?\w+\s+ON\s+(\w+)\s*(?:USING\s+\w+\s*)?\(([^)]*)\)/gi
    )) {
      add(m[1], m[2]);
    }

    // ALTER TABLE t ADD CONSTRAINT name UNIQUE (cols)
    for (const m of sql.matchAll(
      /ALTER TABLE\s+(\w+)\s+ADD CONSTRAINT\s+\w+\s+UNIQUE\s*\(([^)]*)\)/gi
    )) {
      add(m[1], m[2]);
    }

    // Constraints declared inside CREATE TABLE bodies.
    for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)\s*\(([\s\S]*?)\n\);/g)) {
      const [, table, body] = m;
      for (const line of body.split('\n')) {
        // Table-level: UNIQUE(a, b) / PRIMARY KEY (a, b)
        const tableLevel = line.match(/^\s*(?:UNIQUE|PRIMARY KEY)\s*\(([^)]*)\)/i);
        if (tableLevel) {
          add(table, tableLevel[1]);
          continue;
        }
        // Column-level: `col TEXT NOT NULL UNIQUE,` / `id UUID PRIMARY KEY ...`
        const colLevel = line.match(/^\s{2,}(\w+)\s+[A-Za-z]/);
        if (colLevel && /\b(UNIQUE|PRIMARY KEY)\b/i.test(line)) {
          add(table, colLevel[1]);
        }
      }
    }
  }

  return keys;
}

/** Every `.from('table')… onConflict: 'cols'` pair in the backend source. */
function onConflictTargets(): Array<{ file: string; table: string; cols: string }> {
  const found: Array<{ file: string; table: string; cols: string }> = [];

  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (entry.endsWith('.ts')) out.push(full);
    }
    return out;
  };

  for (const full of walk(srcDir)) {
    const text = readFileSync(full, 'utf8');
    const file = full.slice(srcDir.length + 1).replace(/\\/g, '/');
    // `.from('table')` then, within a reasonable window, `onConflict: '...'`.
    // The window stops at the next `.from(` so a later query is not attributed
    // to an earlier table.
    for (const m of text.matchAll(/\.from\('(\w+)'\)((?:(?!\.from\(')[\s\S]){0,600}?)onConflict:\s*'([^']+)'/g)) {
      found.push({ file, table: m[1], cols: m[3] });
    }
  }

  return found;
}

const uniqueKeys = uniqueKeysFromMigrations();
const targets = onConflictTargets();

describe('upsert onConflict targets are backed by a unique constraint', () => {
  it('parsed unique constraints out of the migrations', () => {
    // Column-level UNIQUE.
    expect(uniqueKeys.get('call_records')?.has('retell_call_id')).toBe(true);
    // Table-level composite UNIQUE.
    expect(uniqueKeys.get('crm_connections')?.has(norm('client_id, crm_type'))).toBe(true);
    // ALTER TABLE ... ADD CONSTRAINT ... UNIQUE.
    expect(
      uniqueKeys.get('crm_sync_logs')?.has(norm('client_id, entity_type, entity_id, operation'))
    ).toBe(true);
  });

  it('found onConflict call sites to check', () => {
    expect(targets.length).toBeGreaterThan(10);
  });

  it('every onConflict target has a matching unique constraint', () => {
    const problems: string[] = [];

    for (const { file, table, cols } of targets) {
      const known = uniqueKeys.get(table);
      if (!known) {
        problems.push(`${file}: ${table} is not declared in any migration`);
        continue;
      }
      if (!known.has(norm(cols))) {
        problems.push(
          `${file}: ${table}.(${cols}) has no unique constraint — upsert will fail 42P10. ` +
            `Unique keys on ${table}: ${[...known].map((k) => `(${k})`).join(' ') || 'none'}`
        );
      }
    }

    expect(problems).toEqual([]);
  });

  it('specifically covers the three call_id tables that shipped broken', () => {
    // The transcript-loss bug. Keeping these named means the regression stays
    // legible even if the general check above is ever loosened.
    for (const table of ['call_summaries', 'call_transcripts', 'conversations']) {
      expect(uniqueKeys.get(table)?.has('call_id'), `${table}.call_id must be UNIQUE`).toBe(true);
    }
  });
});
