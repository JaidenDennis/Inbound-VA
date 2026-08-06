#!/usr/bin/env node
/**
 * Migration runner for supabase/migrations/*.sql.
 *
 * WHY THIS EXISTS
 * ---------------
 * The documented path was "paste supabase/setup.sql into the SQL Editor", which
 * is fine for standing up a fresh project and wrong for applying one new
 * migration to a database that already has data: it re-runs everything, offers
 * no record of what has been applied, and gives no way to stop at the first
 * error.
 *
 * This applies migrations in order, one transaction each, and records what ran
 * in `schema_migrations`. A migration that fails rolls back and stops the run,
 * so the database is never left half-migrated.
 *
 * USAGE
 *   node scripts/migrate.mjs status              # what is applied, what is pending
 *   node scripts/migrate.mjs up                  # apply everything pending
 *   node scripts/migrate.mjs up --to 018         # apply pending up to and including 018
 *   node scripts/migrate.mjs baseline --to 015   # mark 001-015 applied WITHOUT running them
 *
 * `baseline` is for adopting this runner on a database that was built the old
 * way: those migrations really are applied, there is just no record of it.
 *
 * Connection comes from DATABASE_URL in .env (override with --env <path>).
 */

import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const migrationsDir = join(repoRoot, 'supabase', 'migrations');

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const command = argv[0] ?? 'status';
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
const envPath = resolve(repoRoot, flag('env') ?? '.env');
const upTo = flag('to');

if (!['status', 'up', 'baseline'].includes(command)) {
  console.error(`Unknown command: ${command}. Expected status | up | baseline.`);
  process.exit(1);
}

// ── env ──────────────────────────────────────────────────────────────────────
function loadEnv(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    console.error(`Cannot read ${path}. Pass --env <path> if it lives elsewhere.`);
    process.exit(1);
  }
  return Object.fromEntries(
    raw
      .split(/\r?\n/)
      .filter((line) => line && !line.trimStart().startsWith('#') && line.includes('='))
      .map((line) => {
        const i = line.indexOf('=');
        return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
      })
  );
}

const env = loadEnv(envPath);
if (!env.DATABASE_URL) {
  console.error(`DATABASE_URL is not set in ${envPath}.`);
  process.exit(1);
}

/** Host only — enough to confirm the target, without printing the password. */
function describeTarget(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

// ── migrations on disk ───────────────────────────────────────────────────────
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const versionOf = (file) => file.slice(0, 3);
const checksum = (sql) => createHash('sha256').update(sql).digest('hex').slice(0, 16);

// ── run ──────────────────────────────────────────────────────────────────────
const client = new pg.Client({
  connectionString: env.DATABASE_URL,
  // Supabase terminates TLS with its own CA; the connection is encrypted, the
  // certificate chain just is not in Node's default trust store.
  ssl: { rejectUnauthorized: false },
  statement_timeout: 120_000,
});

await client.connect();
console.log(`Target: ${describeTarget(env.DATABASE_URL)}`);

// This database already had a schema_migrations table (version / applied_at /
// baselined) from an earlier convention. Extend it additively rather than
// expecting our own shape — the existing rows are the record of what has
// already run, and are not worth discarding for a tidier column list.
await client.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version     TEXT PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- true when recorded by the baseline command rather than executed here
    baselined   BOOLEAN NOT NULL DEFAULT false
  )`);
await client.query(`ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS filename TEXT`);
await client.query(`ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT`);

const { rows: appliedRows } = await client.query(
  'SELECT version, filename, checksum, applied_at, baselined FROM schema_migrations'
);
const applied = new Map(appliedRows.map((r) => [r.version, r]));

const pending = files.filter((f) => !applied.has(versionOf(f)));
const selected = upTo ? pending.filter((f) => versionOf(f) <= upTo) : pending;

if (command === 'status') {
  console.log('\nversion  state       file');
  for (const file of files) {
    const row = applied.get(versionOf(file));
    const state = !row ? 'PENDING' : row.baselined ? 'baselined' : 'applied';
    const stamp = row ? new Date(row.applied_at).toISOString().slice(0, 16).replace('T', ' ') : '';
    console.log(`${versionOf(file)}      ${state.padEnd(10)}  ${file} ${stamp}`);

    // A changed checksum means the file was edited after being applied — the
    // repo and the database no longer agree about what version 0NN contains.
    if (row && !row.baselined && row.checksum) {
      const current = checksum(readFileSync(join(migrationsDir, file), 'utf8'));
      if (current !== row.checksum) {
        console.log(`         ^ WARNING: file changed since it was applied (${row.checksum} → ${current})`);
      }
    }
  }
  console.log(`\n${applied.size} applied, ${pending.length} pending.`);
  await client.end();
  process.exit(0);
}

if (selected.length === 0) {
  console.log('\nNothing to do — no pending migrations in range.');
  await client.end();
  process.exit(0);
}

if (command === 'baseline') {
  console.log(`\nBaselining ${selected.length} migration(s) — recording as applied WITHOUT running them:`);
  for (const file of selected) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    await client.query(
      `INSERT INTO schema_migrations (version, filename, checksum, baselined)
       VALUES ($1, $2, $3, true) ON CONFLICT (version) DO NOTHING`,
      [versionOf(file), file, checksum(sql)]
    );
    console.log(`  ${versionOf(file)}  ${file}`);
  }
  await client.end();
  process.exit(0);
}

console.log(`\nApplying ${selected.length} migration(s):`);

for (const file of selected) {
  const sql = readFileSync(join(migrationsDir, file), 'utf8');
  const started = Date.now();
  process.stdout.write(`  ${versionOf(file)}  ${file} … `);

  try {
    // One transaction per migration. Postgres DDL is transactional, so a
    // migration that raises partway leaves nothing behind — which is what makes
    // the assertion blocks inside these files useful rather than dangerous.
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations (version, filename, checksum) VALUES ($1, $2, $3)`,
      [versionOf(file), file, checksum(sql)]
    );
    await client.query('COMMIT');
    console.log(`ok (${Date.now() - started}ms)`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.log('FAILED');
    console.error(`\n${file} was rolled back. Nothing from it was applied.\n`);
    console.error(`  ${err.message}`);
    if (err.hint) console.error(`  hint: ${err.hint}`);
    if (err.where) console.error(`  where: ${err.where}`);
    console.error(`\nMigrations after this one were not attempted.`);
    await client.end();
    process.exit(1);
  }
}

console.log('\nAll selected migrations applied.');
await client.end();
