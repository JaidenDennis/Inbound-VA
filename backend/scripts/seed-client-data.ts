/**
 * Apply client DATA files (supabase/data/*.sql) to the database in DATABASE_URL.
 *
 * These are not schema migrations — they seed or update one client's settings,
 * catalog, and offering flags. Every file is written to be idempotent, so this
 * runner deliberately does NOT track what it has applied: re-running a file is
 * how you push edited client config.
 *
 *   npm run seed:data                          # apply every file, in order
 *   npm run seed:data -- 007_bright_smile_dental.sql   # apply just one
 *   npm run seed:data -- --dry                 # list what would run
 *
 * Each file runs in its own transaction and rolls back on error.
 *
 * After seeding a client, re-provision its agent so the new prompt ships:
 *   npm run provision -- <slug> --template=<vertical>
 */
import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', '..', 'supabase', 'data');
const dryRun = process.argv.includes('--dry');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  const all = readdirSync(dataDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const files = only.length ? all.filter((f) => only.some((o) => f === o || f.includes(o))) : all;

  if (!files.length) {
    console.error(`No matching data files in ${dataDir}${only.length ? ` for: ${only.join(', ')}` : ''}`);
    process.exitCode = 1;
    return;
  }

  if (dryRun) {
    console.log('DRY RUN — would apply, in order:');
    for (const f of files) console.log(`  ${f}`);
    return;
  }

  // Supabase requires TLS; the direct-connection cert is fine to accept.
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log(`Connected to ${new URL(connectionString).hostname}`);

  try {
    for (const file of files) {
      const sql = readFileSync(join(dataDir, file), 'utf8');
      console.log(`  applying ${file} ...`);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');
        console.log(`  ✓ ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Data file ${file} failed (rolled back): ${(err as Error).message}`);
      }
    }
    console.log(`\nDone. ${files.length} file(s) applied.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('\nSeed failed:', err.message);
  process.exit(1);
});
