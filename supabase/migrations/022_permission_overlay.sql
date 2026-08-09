-- ============================================================
-- GRAVVIA ENGAGE – Enterprise dashboard: permission overlay
-- Run order: 022  (NEVER edit earlier migrations)
--
-- Three things, all additive:
--
--   1. Eight new grants in the vocabulary, covering the enterprise dashboard's
--      work queue (flags, callbacks), exports, and the two `configure:` grants
--      that gate role management and alert rules.
--
--   2. A fourth client role, `client_admin`, sitting between client_owner and
--      client_manager. It configures the agent, knowledge and integrations but
--      cannot manage users or roles. Owner and Admin differ on exactly one
--      grant: configure:roles.
--
--   3. `client_permission_overrides` — a per-tenant overlay on top of the global
--      role grants, so an enterprise buyer can be given a variation without
--      shipping a new role for every request.
--
-- WHY AN OVERLAY AND NOT A REWRITE
-- The design called for three capability axes (view / act / configure). The
-- vocabulary seeded by 016 already IS that: the verb is the axis. `calls:read`
-- is a view grant, `bookings:write` an act grant, `knowledge:write` a configure
-- grant. Renaming 24 strings across 25 files to express what they already
-- express is risk with no payoff, so the axes are adopted as classification and
-- only the genuinely missing grants are added here.
--
-- THE ESCALATION BOUNDARY
-- The overlay is writable by tenant admins, so without a guard a client_owner
-- grants themselves system:write and reads every tenant's error console. Two
-- independent defences, because one is not enough for a privilege boundary:
-- a CHECK constraint on this table (below), and a re-check in the service that
-- writes it (clientPermission.service.ts). A future migration that relaxes the
-- CHECK still cannot open the hole on its own.
--
-- Rollback: supabase/rollbacks/022_permission_overlay_rollback.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. The new client role
-- ------------------------------------------------------------
INSERT INTO roles (name, description, scope) VALUES
  ('client_admin', 'Client: configures the agent, knowledge and integrations; no user or role management', 'client')
ON CONFLICT (name) DO UPDATE SET scope = EXCLUDED.scope;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
  role IN ('super_admin', 'support_agent', 'analyst',
           'client_owner', 'client_admin', 'client_manager', 'client_viewer')
);

-- ------------------------------------------------------------
-- 2. New grants on existing roles
--
-- Additive per role — 016 rebuilt the table wholesale because it had drifted;
-- there is no drift now, so these are inserts rather than another full rebuild.
-- ------------------------------------------------------------

-- super_admin and support_agent get everything new: they operate every tenant.
INSERT INTO permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
CROSS JOIN (VALUES
  ('flags:read'), ('flags:write'),
  ('callbacks:read'), ('callbacks:write'),
  ('exports:read'),
  ('configure:roles'), ('configure:alerts')
) AS p(permission)
WHERE r.name IN ('super_admin', 'support_agent')
ON CONFLICT (role_id, permission) DO NOTHING;

-- analyst stays read-only across tenants.
INSERT INTO permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
CROSS JOIN (VALUES
  ('flags:read'), ('callbacks:read'), ('exports:read')
) AS p(permission)
WHERE r.name = 'analyst'
ON CONFLICT (role_id, permission) DO NOTHING;

-- client_owner — the tenant's Owner. Everything a tenant can hold, including
-- configure:roles, which is the single grant separating Owner from Admin.
INSERT INTO permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
CROSS JOIN (VALUES
  ('flags:read'), ('flags:write'),
  ('callbacks:read'), ('callbacks:write'),
  ('exports:read'),
  ('configure:roles'), ('configure:alerts'),
  -- Agent configuration becomes client-reachable here. The PROMPT does not:
  -- agent.service rejects any client-scope write touching agent_prompt or the
  -- vertical template regardless of grants (see spec §6.3).
  ('agents:read'), ('agents:write'),
  ('crm:read'), ('crm:write')
) AS p(permission)
WHERE r.name = 'client_owner'
ON CONFLICT (role_id, permission) DO NOTHING;

-- client_admin — the new role. Same as owner MINUS configure:roles,
-- users:read/users:write. Seeded in full because the role is new.
INSERT INTO permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
CROSS JOIN (VALUES
  ('clients:read'),
  ('calls:read'),
  ('bookings:read'), ('bookings:write'),
  ('analytics:read'),
  ('settings:read'),
  ('tickets:read'), ('tickets:write'),
  ('transcripts:read'),
  ('knowledge:read'), ('knowledge:write'),
  ('agents:read'), ('agents:write'),
  ('crm:read'), ('crm:write'),
  ('flags:read'), ('flags:write'),
  ('callbacks:read'), ('callbacks:write'),
  ('exports:read'),
  ('configure:alerts')
) AS p(permission)
WHERE r.name = 'client_admin'
ON CONFLICT (role_id, permission) DO NOTHING;

-- client_manager — view and act, no configure. Gains the work queue and export.
INSERT INTO permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
CROSS JOIN (VALUES
  ('flags:read'), ('flags:write'),
  ('callbacks:read'), ('callbacks:write'),
  ('exports:read')
) AS p(permission)
WHERE r.name = 'client_manager'
ON CONFLICT (role_id, permission) DO NOTHING;

-- client_viewer — reports only. Export is a read; the work queue is not.
-- Deliberately NO flags:* and NO callbacks:*: this is the read-only compliance
-- role, and it stays that way.
INSERT INTO permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
CROSS JOIN (VALUES
  ('exports:read')
) AS p(permission)
WHERE r.name = 'client_viewer'
ON CONFLICT (role_id, permission) DO NOTHING;

-- ------------------------------------------------------------
-- 3. The per-tenant overlay
--
-- location_id ships nullable and unused. Nothing reads it yet. Multi-location
-- is a separate project, and this costs one column now against a migration
-- over a populated permissions table later.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_permission_overrides (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  permission  TEXT NOT NULL,
  granted     BOOLEAN NOT NULL,
  location_id UUID,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, role, permission),

  -- Defence 1 of 2. Only client-scope roles may be overridden: a row naming a
  -- platform role would let a tenant edit Gravvia staff grants.
  CONSTRAINT cpo_role_is_client_scope CHECK (
    role IN ('client_owner', 'client_admin', 'client_manager', 'client_viewer')
  ),

  -- The allowlist. Every grant a tenant may hold, and nothing else. Absent by
  -- design and individually load-bearing:
  --   recordings:read  – call audio is staff-only for troubleshooting (016)
  --   system:read/write– the cross-tenant error console
  --   clients:write    – tenant provisioning and deletion
  --   users:*          – seat administration stays with the owner role itself,
  --                      not something a tenant can hand around via overlay
  --   settings:write   – platform settings
  --   tickets:triage   – triage is platform-only; clients raise, staff route
  CONSTRAINT cpo_permission_is_client_safe CHECK (
    permission IN (
      'clients:read',
      'calls:read',
      'bookings:read', 'bookings:write',
      'analytics:read',
      'settings:read',
      'tickets:read', 'tickets:write',
      'transcripts:read',
      'knowledge:read', 'knowledge:write',
      'agents:read', 'agents:write',
      'crm:read', 'crm:write',
      'flags:read', 'flags:write',
      'callbacks:read', 'callbacks:write',
      'exports:read',
      'configure:roles', 'configure:alerts'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_cpo_client_role ON client_permission_overrides(client_id, role);

DROP TRIGGER IF EXISTS trg_cpo_updated_at ON client_permission_overrides;
CREATE TRIGGER trg_cpo_updated_at
  BEFORE UPDATE ON client_permission_overrides
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: same defence-in-depth posture as the other tenant tables (see 008 header).
-- The API uses the service role and enforces tenancy in middleware; this policy
-- is the backstop if a token ever reaches PostgREST directly.
ALTER TABLE client_permission_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cpo_tenant_select ON client_permission_overrides;
CREATE POLICY cpo_tenant_select ON client_permission_overrides
  FOR SELECT TO authenticated
  USING (client_id::text = COALESCE(auth.jwt() ->> 'client_id', ''));

-- ------------------------------------------------------------
-- 4. Verification — abort rather than half-migrate
--
-- Same posture as 016: a partially applied permission migration locks people
-- out with no obvious cause, so every invariant is asserted while the
-- transaction can still roll back.
-- ------------------------------------------------------------
DO $$
DECLARE
  admin_grants   INTEGER;
  owner_roles    INTEGER;
  admin_roles    INTEGER;
  bad_scope      INTEGER;
  viewer_flags   INTEGER;
BEGIN
  -- The new role exists and actually carries grants.
  SELECT COUNT(*) INTO admin_grants
  FROM permissions p JOIN roles r ON r.id = p.role_id
  WHERE r.name = 'client_admin';
  IF admin_grants = 0 THEN
    RAISE EXCEPTION 'Migration 022: client_admin has zero permissions';
  END IF;

  -- Owner holds configure:roles; Admin does not. This is the ONE grant that
  -- separates them, so it is asserted rather than trusted.
  SELECT COUNT(*) INTO owner_roles
  FROM permissions p JOIN roles r ON r.id = p.role_id
  WHERE r.name = 'client_owner' AND p.permission = 'configure:roles';
  IF owner_roles <> 1 THEN
    RAISE EXCEPTION 'Migration 022: client_owner must hold configure:roles exactly once (found %)', owner_roles;
  END IF;

  SELECT COUNT(*) INTO admin_roles
  FROM permissions p JOIN roles r ON r.id = p.role_id
  WHERE r.name = 'client_admin' AND p.permission = 'configure:roles';
  IF admin_roles <> 0 THEN
    RAISE EXCEPTION 'Migration 022: client_admin must NOT hold configure:roles';
  END IF;

  -- client_viewer stays the read-only compliance role.
  SELECT COUNT(*) INTO viewer_flags
  FROM permissions p JOIN roles r ON r.id = p.role_id
  WHERE r.name = 'client_viewer'
    AND p.permission IN ('flags:write', 'callbacks:write', 'knowledge:write',
                         'agents:write', 'configure:roles', 'transcripts:read');
  IF viewer_flags <> 0 THEN
    RAISE EXCEPTION 'Migration 022: client_viewer picked up % write/transcript grant(s)', viewer_flags;
  END IF;

  -- No client role may hold a platform-only grant.
  SELECT COUNT(*) INTO bad_scope
  FROM permissions p JOIN roles r ON r.id = p.role_id
  WHERE r.scope = 'client'
    AND p.permission IN ('system:read', 'system:write', 'recordings:read',
                         'clients:write', 'settings:write', 'tickets:triage');
  IF bad_scope > 0 THEN
    RAISE EXCEPTION 'Migration 022: % platform-only grant(s) leaked to a client role', bad_scope;
  END IF;

  -- Every role still has a scope and at least one grant (016's invariants).
  IF EXISTS (SELECT 1 FROM roles WHERE scope IS NULL) THEN
    RAISE EXCEPTION 'Migration 022: a role has no scope';
  END IF;
  IF EXISTS (
    SELECT 1 FROM roles r LEFT JOIN permissions p ON p.role_id = r.id
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Migration 022: a role has zero permissions';
  END IF;
END $$;
