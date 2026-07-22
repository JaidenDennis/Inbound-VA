/**
 * Migration runner — applies supabase/migrations/*.sql to the database in
 * DATABASE_URL, tracked in a `schema_migrations` table so each file runs once.
 *
 *   npm run migrate            # apply all pending migrations
 *   npm run migrate -- --dry   # list what WOULD run, change nothing
 *
 * BASELINING: migrations 001–010 were applied by hand (Supabase SQL editor)
 * before this runner existed, and migration 001 uses bare CREATE TABLE (not
 * idempotent). So on a DB that already has the schema (detected by the presence
 * of the `clients` table), any not-yet-tracked migration numbered <= 010 is
 * RECORDED as applied WITHOUT executing it. Migrations 011+ are idempotent
 * (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / DROP POLICY IF EXISTS) and run
 * normally, inside a transaction each.
 *
 * On a FRESH database (no `clients` table) this runner refuses to baseline and
 * tells you to run supabase/setup.sql once first — that file is the idempotent
 * full bootstrap.
 */
import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const BASELINE_MAX = 10; // migrations <= this were applied before the tracker existed

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', '..', 'supabase', 'migrations');
const dryRun = process.argv.includes('--dry');

function versionOf(file: string): number {
  const m = /^(\d+)/.exec(file);
  return m ? Number(m[1]) : NaN;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  // Supabase requires TLS; the direct-connection cert is fine to accept.
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log(`Connected to ${new URL(connectionString).hostname}`);

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        baselined  BOOLEAN NOT NULL DEFAULT false
      )
    `);

    const { rows: appliedRows } = await client.query<{ version: string }>(
      'SELECT version FROM schema_migrations'
    );
    const applied = new Set(appliedRows.map((r) => r.version));

    const { rows: clientsRows } = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='clients' LIMIT 1`
    );
    const schemaExists = clientsRows.length > 0;

    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    if (!schemaExists && applied.size === 0) {
      console.error(
        '\nNo `clients` table found — this looks like a FRESH database.\n' +
          'Run supabase/setup.sql once (Supabase SQL editor or psql), then re-run this migrator\n' +
          'for future migrations. Refusing to baseline a schema that is not there.'
      );
      process.exitCode = 1;
      return;
    }

    let ran = 0;
    let baselined = 0;
    for (const file of files) {
      const version = String(versionOf(file)).padStart(3, '0');
      if (applied.has(version) || applied.has(file) || applied.has(String(versionOf(file)))) {
        continue;
      }

      const isBaseline = schemaExists && versionOf(file) <= BASELINE_MAX;
      if (isBaseline) {
        if (dryRun) {
          console.log(`  [baseline] ${file} (recorded as already applied, not executed)`);
        } else {
          await client.query(
            'INSERT INTO schema_migrations(version, baselined) VALUES ($1, true) ON CONFLICT DO NOTHING',
            [version]
          );
          console.log(`  baselined ${file}`);
        }
        baselined++;
        continue;
      }

      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      if (dryRun) {
        console.log(`  [would run] ${file}`);
        ran++;
        continue;
      }

      console.log(`  applying ${file} ...`);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [version]);
        await client.query('COMMIT');
        console.log(`  ✓ ${file}`);
        ran++;
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed (rolled back): ${(err as Error).message}`);
      }
    }

    console.log(
      `\nDone. ${dryRun ? 'DRY RUN — nothing changed. ' : ''}` +
        `${ran} applied, ${baselined} baselined, ${files.length - ran - baselined - 0} already up to date.`
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('\nMigration failed:', err.message);
  process.exit(1);
});
