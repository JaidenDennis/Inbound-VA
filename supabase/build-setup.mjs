#!/usr/bin/env node
/**
 * Regenerates supabase/setup.sql from supabase/migrations/*.sql.
 *
 * WHY THIS EXISTS
 * ---------------
 * setup.sql is the "paste into the Supabase SQL Editor once" bootstrap for a
 * fresh project. It drifted badly (it was hand-maintained and ended up missing
 * 7 tables and every column added after migration 008), which silently breaks
 * the dashboard's tickets / calls / onboarding features at runtime.
 *
 * setup.sql is now DERIVED, never hand-edited. After adding a migration:
 *
 *     node supabase/build-setup.mjs
 *
 * WHAT IT DOES
 * ------------
 * Concatenates every migration in run order and rewrites migration 001 to be
 * idempotent (001 predates the IF NOT EXISTS convention the later migrations
 * follow, so re-running the raw file errors on existing objects).
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, 'migrations');

/**
 * Migration 001 uses bare CREATE TABLE / CREATE INDEX / CREATE TRIGGER, which
 * throw "already exists" on a re-run. Every migration from 004 onward already
 * uses IF NOT EXISTS + DROP ... IF EXISTS, so only 001 needs rewriting.
 */
function makeIdempotent(sql) {
  return (
    sql
      .replace(/CREATE TABLE (?!IF NOT EXISTS)/g, 'CREATE TABLE IF NOT EXISTS ')
      .replace(/CREATE INDEX (?!IF NOT EXISTS)/g, 'CREATE INDEX IF NOT EXISTS ')
      .replace(/CREATE UNIQUE INDEX (?!IF NOT EXISTS)/g, 'CREATE UNIQUE INDEX IF NOT EXISTS ')
      // A trigger can't be declared IF NOT EXISTS, so drop it first. Capture the
      // trigger name and the table it fires on to build the DROP.
      .replace(
        /CREATE TRIGGER (\w+)\s*\n\s*BEFORE UPDATE ON (\w+)/g,
        (_m, trigger, table) =>
          `DROP TRIGGER IF EXISTS ${trigger} ON ${table};\nCREATE TRIGGER ${trigger}\n  BEFORE UPDATE ON ${table}`
      )
      // Collapse the double space the IF NOT EXISTS insertions can leave behind.
      .replace(/IF NOT EXISTS  +/g, 'IF NOT EXISTS ')
  );
}

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

if (files.length === 0) {
  console.error('No migrations found in', migrationsDir);
  process.exit(1);
}

const header = `-- ============================================================================
-- GRAVVIA ENGAGE — COMPLETE SUPABASE SETUP (single file)
-- ============================================================================
--
--   >>> GENERATED FILE — DO NOT EDIT BY HAND. <<<
--   Source: supabase/migrations/*.sql
--   Regenerate: node supabase/build-setup.mjs
--
-- HOW TO USE
--   Paste this entire file into the Supabase SQL Editor and run it once.
--   It is idempotent — safe to re-run after adding migrations.
--
-- WHAT IT CREATES
--   • Extensions (uuid-ossp, pgcrypto)
--   • All tables, indexes, constraints and updated_at triggers
--   • Row Level Security + tenant-isolation policies
--   • Supabase role grants (service_role needs these or every query 42501s)
--   • The RBAC roles/permissions seed
--
-- WHAT IT DOES *NOT* CREATE
--   • Any admin user. There is no default login and no default password.
--     Create your first super_admin explicitly — see the block at the end.
--   • Any sample/demo client data. See supabase/seed.sql for that (dev only).
--
-- Generated from ${files.length} migrations: ${files.join(', ')}
-- ============================================================================

`;

const body = files
  .map((file) => {
    const raw = readFileSync(join(migrationsDir, file), 'utf8');
    const sql = file.startsWith('001_') ? makeIdempotent(raw) : raw;
    return [
      '',
      '-- ============================================================================',
      `-- SOURCE: migrations/${file}`,
      '-- ============================================================================',
      '',
      sql.trimEnd(),
      '',
    ].join('\n');
  })
  .join('\n');

const footer = `

-- ============================================================================
-- BOOTSTRAP YOUR FIRST SUPER ADMIN
-- ----------------------------------------------------------------------------
-- Deliberately NOT automatic. A shipped default admin password is the single
-- most common way a launched SaaS gets taken over on day one.
--
-- To create your login: replace BOTH placeholders below, uncomment the block,
-- and run it. The password is hashed with pgcrypto's bcrypt, which is the same
-- algorithm bcryptjs verifies against in the API — so the hash is portable.
--
-- Use a password manager. Minimum 16 characters.
-- ============================================================================

-- INSERT INTO users (email, name, password_hash, role, is_active)
-- VALUES (
--   'you@yourdomain.com',                        -- << your email
--   'Your Name',                                 -- << your name
--   crypt('REPLACE_WITH_A_STRONG_PASSWORD', gen_salt('bf', 12)),
--   'super_admin',
--   true
-- )
-- ON CONFLICT (email) DO NOTHING;

-- ============================================================================
-- VERIFY THE INSTALL
-- ----------------------------------------------------------------------------
-- Expect 27 rows. A lower count means the script did not finish — scroll up in
-- the SQL Editor output for the first error and fix that before deploying.
-- ============================================================================

SELECT count(*) AS tables_created
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
`;

const out = header + body + footer;
writeFileSync(join(here, 'setup.sql'), out, 'utf8');

const tables = [...out.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
console.log(`setup.sql written — ${files.length} migrations, ${new Set(tables).size} tables:`);
console.log([...new Set(tables)].sort().join(', '));
