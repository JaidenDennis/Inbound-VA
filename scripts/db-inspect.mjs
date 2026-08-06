#!/usr/bin/env node
/**
 * Read-only inspection of the target database. Nothing here writes.
 *
 * Exists so "what state is the database actually in" is a command rather than a
 * guess, before and after a migration run.
 *
 *   node scripts/db-inspect.mjs
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(repoRoot, process.argv[2] ?? '.env');

const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.trimStart().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

const url = env.DATABASE_URL_POOLER || env.DATABASE_URL;
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log(`Target: ${new URL(url).hostname}\n`);

const q = async (label, sql) => {
  try {
    const { rows } = await client.query(sql);
    console.log(`### ${label}`);
    console.table(rows);
  } catch (err) {
    console.log(`### ${label}\n  (query failed: ${err.message})`);
  }
};

await q('existing schema_migrations shape', `
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='schema_migrations'
  ORDER BY ordinal_position`);

await q('schema_migrations contents', `SELECT * FROM public.schema_migrations LIMIT 30`);

await q('which of 016-020 are already applied', `
  SELECT
    (SELECT count(*)::int FROM information_schema.columns
       WHERE table_name='roles' AND column_name='scope')                AS m016_roles_scope,
    (SELECT count(*)::int FROM information_schema.tables
       WHERE table_name='system_errors')                                AS m017_system_errors,
    (SELECT count(*)::int FROM information_schema.tables
       WHERE table_name='agent_config_versions')                        AS m018_agent_versions,
    (SELECT count(*)::int FROM information_schema.columns
       WHERE table_name='ticket_messages' AND column_name='visibility') AS m019_visibility,
    (SELECT count(*)::int FROM information_schema.routines
       WHERE routine_name='report_kpis')                                AS m020_report_kpis`);

await q('users by role — what 016 rewrites', `
  SELECT role, (client_id IS NULL) AS is_platform, count(*)::int AS users
  FROM users GROUP BY 1,2 ORDER BY 1,2`);

await q('users.role constraint', `
  SELECT pg_get_constraintdef(oid) AS definition
  FROM pg_constraint WHERE conname='users_role_check'`);

await q('roles table', `SELECT name, description FROM roles ORDER BY name`);

await q('permissions per role', `
  SELECT r.name, count(p.id)::int AS grants
  FROM roles r LEFT JOIN permissions p ON p.role_id=r.id
  GROUP BY r.name ORDER BY r.name`);

await q('row counts', `
  SELECT 'clients' AS t, count(*)::int AS n FROM clients
  UNION ALL SELECT 'users', count(*)::int FROM users
  UNION ALL SELECT 'tickets', count(*)::int FROM tickets
  UNION ALL SELECT 'ticket_messages', count(*)::int FROM ticket_messages
  UNION ALL SELECT 'calls', count(*)::int FROM calls
  UNION ALL SELECT 'call_records', count(*)::int FROM call_records
  ORDER BY 1`);

await client.end();
