-- ============================================================
-- GRAVVIA ENGAGE – RBAC role families
-- Run order: 016  (NEVER edit earlier migrations)
--
-- Splits roles into two scopes:
--   platform  – Gravvia staff, users.client_id IS NULL
--   client    – tenant users, users.client_id IS NOT NULL
--
-- Also makes the `permissions` table the single source of truth at runtime.
-- Until this migration, backend/src/types/auth.types.ts held a hardcoded
-- ROLE_PERMISSIONS map that was the ONLY thing read at request time, while this
-- table sat unused and had already drifted (tickets:* existed in code, never
-- seeded here). That map is deleted in the same change that ships this file.
--
-- Rollback: supabase/rollbacks/016_rbac_role_families_rollback.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. Role scope
-- ------------------------------------------------------------
ALTER TABLE roles ADD COLUMN IF NOT EXISTS scope TEXT;

INSERT INTO roles (name, description) VALUES
  ('support_agent',  'Platform staff: support queue, calls, recordings, system logs, agent config'),
  ('analyst',        'Platform staff: read-only across all tenants'),
  ('client_owner',   'Client: owns their account, users, knowledge base and reports'),
  ('client_manager', 'Client: reports, transcripts, tickets, bookings'),
  ('client_viewer',  'Client: reports only')
ON CONFLICT (name) DO NOTHING;

UPDATE roles SET scope = 'platform' WHERE name IN ('super_admin', 'support_agent', 'analyst');
UPDATE roles SET scope = 'client'   WHERE name IN ('client_owner', 'client_manager', 'client_viewer');

-- ------------------------------------------------------------
-- 2. Backfill users onto the new role names
--
-- The old role set (super_admin/admin/agent/viewer) was shared by staff and
-- tenant users, so the same name meant different things depending on client_id.
-- Split on client_id, which is what actually distinguished them.
-- ------------------------------------------------------------
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

UPDATE users SET role = CASE
  WHEN role = 'super_admin' AND client_id IS NULL THEN 'super_admin'
  WHEN role = 'super_admin'                       THEN 'client_owner'
  WHEN role = 'admin'       AND client_id IS NULL THEN 'support_agent'
  WHEN role = 'admin'                             THEN 'client_owner'
  WHEN role = 'agent'       AND client_id IS NULL THEN 'support_agent'
  WHEN role = 'agent'                             THEN 'client_manager'
  WHEN role = 'viewer'      AND client_id IS NULL THEN 'analyst'
  WHEN role = 'viewer'                            THEN 'client_viewer'
  ELSE role
END
WHERE role IN ('super_admin', 'admin', 'agent', 'viewer');

ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
  role IN ('super_admin', 'support_agent', 'analyst',
           'client_owner', 'client_manager', 'client_viewer')
);

-- Retire the old role rows now that no user references them.
DELETE FROM roles WHERE name IN ('admin', 'agent', 'viewer');

-- ------------------------------------------------------------
-- 3. Reseed permissions
--
-- Full rebuild rather than an incremental patch: the table had drifted from the
-- code it was supposed to mirror, so the only safe state is a known one.
-- ------------------------------------------------------------
DELETE FROM permissions;

-- super_admin — everything in the vocabulary.
INSERT INTO permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
CROSS JOIN (VALUES
  ('clients:read'), ('clients:write'),
  ('calls:read'), ('calls:write'),
  ('bookings:read'), ('bookings:write'),
  ('crm:read'), ('crm:write'),
  ('analytics:read'),
  ('settings:read'), ('settings:write'),
  ('users:read'), ('users:write'),
  ('tickets:read'), ('tickets:write'), ('tickets:triage'),
  ('transcripts:read'), ('recordings:read'),
  ('knowledge:read'), ('knowledge:write'),
  ('agents:read'), ('agents:write'),
  ('system:read'), ('system:write')
) AS p(permission)
WHERE r.name = 'super_admin';

-- support_agent — operates and troubleshoots every tenant. No users:write and
-- no settings:write: staff accounts and platform settings stay with super_admin.
INSERT INTO permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
CROSS JOIN (VALUES
  ('clients:read'), ('clients:write'),
  ('calls:read'), ('calls:write'),
  ('bookings:read'), ('bookings:write'),
  ('crm:read'), ('crm:write'),
  ('analytics:read'),
  ('settings:read'),
  ('users:read'),
  ('tickets:read'), ('tickets:write'), ('tickets:triage'),
  ('transcripts:read'), ('recordings:read'),
  ('knowledge:read'), ('knowledge:write'),
  ('agents:read'), ('agents:write'),
  ('system:read'), ('system:write')
) AS p(permission)
WHERE r.name = 'support_agent';

-- analyst — read-only across all tenants. Deliberately no transcripts:read and
-- no recordings:read: cross-tenant caller PII is not needed to read aggregates.
INSERT INTO permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
CROSS JOIN (VALUES
  ('clients:read'),
  ('calls:read'),
  ('bookings:read'),
  ('crm:read'),
  ('analytics:read'),
  ('settings:read'),
  ('users:read'),
  ('tickets:read'),
  ('knowledge:read'),
  ('agents:read'),
  ('system:read')
) AS p(permission)
WHERE r.name = 'analyst';

-- client_owner — full control of their own tenant. No agents:* (behavior is
-- staff-owned) and no recordings:read (call audio is staff-only).
INSERT INTO permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
CROSS JOIN (VALUES
  ('clients:read'),
  ('calls:read'),
  ('bookings:read'), ('bookings:write'),
  ('analytics:read'),
  ('settings:read'),
  ('users:read'), ('users:write'),
  ('tickets:read'), ('tickets:write'),
  ('transcripts:read'),
  ('knowledge:read'), ('knowledge:write')
) AS p(permission)
WHERE r.name = 'client_owner';

-- client_manager — day-to-day use, no user administration, no knowledge edits.
INSERT INTO permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
CROSS JOIN (VALUES
  ('clients:read'),
  ('calls:read'),
  ('bookings:read'), ('bookings:write'),
  ('analytics:read'),
  ('tickets:read'), ('tickets:write'),
  ('transcripts:read'),
  ('knowledge:read')
) AS p(permission)
WHERE r.name = 'client_manager';

-- client_viewer — reports only. Keeps tickets:write so they can still raise a
-- support request; triage stays platform-only.
INSERT INTO permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
CROSS JOIN (VALUES
  ('clients:read'),
  ('calls:read'),
  ('bookings:read'),
  ('analytics:read'),
  ('tickets:read'), ('tickets:write')
) AS p(permission)
WHERE r.name = 'client_viewer';

-- ------------------------------------------------------------
-- 4. Verification — abort the transaction rather than half-migrate
--
-- A partially applied role migration locks people out of the dashboard with no
-- obvious cause, so every invariant is asserted here while we can still roll back.
-- ------------------------------------------------------------
DO $$
DECLARE
  bad_scope   INTEGER;
  bad_role    INTEGER;
  no_scope    INTEGER;
  no_grants   INTEGER;
BEGIN
  -- Every user's role must exist in roles, with a scope matching their tenancy.
  SELECT COUNT(*) INTO bad_role
  FROM users u LEFT JOIN roles r ON r.name = u.role
  WHERE r.id IS NULL;
  IF bad_role > 0 THEN
    RAISE EXCEPTION 'Migration 016: % user(s) hold a role with no matching roles row', bad_role;
  END IF;

  SELECT COUNT(*) INTO bad_scope
  FROM users u JOIN roles r ON r.name = u.role
  WHERE (u.client_id IS NULL AND r.scope <> 'platform')
     OR (u.client_id IS NOT NULL AND r.scope <> 'client');
  IF bad_scope > 0 THEN
    RAISE EXCEPTION 'Migration 016: % user(s) hold a role in the wrong scope for their client_id', bad_scope;
  END IF;

  SELECT COUNT(*) INTO no_scope FROM roles WHERE scope IS NULL;
  IF no_scope > 0 THEN
    RAISE EXCEPTION 'Migration 016: % role(s) have no scope', no_scope;
  END IF;

  SELECT COUNT(*) INTO no_grants
  FROM roles r LEFT JOIN permissions p ON p.role_id = r.id
  WHERE p.id IS NULL;
  IF no_grants > 0 THEN
    RAISE EXCEPTION 'Migration 016: % role(s) have zero permissions', no_grants;
  END IF;
END $$;

-- Scope is only NOT NULL once every row is known good.
ALTER TABLE roles ALTER COLUMN scope SET NOT NULL;
ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_scope_check;
ALTER TABLE roles ADD CONSTRAINT roles_scope_check CHECK (scope IN ('platform', 'client'));

CREATE INDEX IF NOT EXISTS idx_permissions_role ON permissions(role_id);
