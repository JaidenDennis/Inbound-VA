-- 037: let a tenant edit its own account details.
--
-- Settings gates the business profile (035) and the billing notification email
-- (036) on `settings:write`. Migration 022 makes `settings:write` platform-only
-- and asserts it: no client-scope role may hold it, and the overlay's CHECK
-- constraint refuses to grant it. So a client_owner opened Settings, saw their
-- own name and address, and could change none of it — the inputs rendered
-- disabled, and the PUT would have replied 403 regardless.
--
-- Granting `settings:write` to client roles was never the fix. That one grant
-- also opens POST /admin/retry-job, tenant provisioning (clients.route),
-- platform alert configuration, and the Retell provisioning route. The name had
-- come to mean two different things: "configure the platform" and "my own
-- record". This splits them.
--
--   settings:write  – platform territory, unchanged, still barred from tenants
--   account:write   – the tenant's own account: who they are, where they are,
--                     and where their invoices go
--
-- Nothing is taken away here. super_admin is granted `account:write` precisely
-- so staff editing a client through the client picker keep the ability they
-- have today via `settings:write`.

-- ------------------------------------------------------------
-- 1. Grants
--
-- Owner and Admin are the two roles that administer an account, and both
-- already hold `settings:read` — they could already SEE the page they could not
-- save. client_manager and client_viewer lack `settings:read` and cannot reach
-- Settings at all, so a write grant there would widen the boundary for nothing.
-- ------------------------------------------------------------
INSERT INTO permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
CROSS JOIN (VALUES
  ('account:write')
) AS p(permission)
WHERE r.name IN ('super_admin', 'client_owner', 'client_admin')
ON CONFLICT (role_id, permission) DO NOTHING;

-- ------------------------------------------------------------
-- 2. Re-declare the overlay allowlist
--
-- 022's constraint is the database half of the escalation boundary; the code
-- half is CLIENT_SAFE_PERMISSIONS in auth.types.ts, and a test asserts the two
-- match exactly. Adding a client-safe grant therefore means re-declaring the
-- constraint here.
--
-- The list below reproduces 022's VERBATIM, plus 'account:write'. The absences
-- are still individually load-bearing and are restated so they are not lost:
--   recordings:read  – call audio is staff-only for troubleshooting (016)
--   system:read/write– the cross-tenant error console
--   clients:write    – tenant provisioning and deletion
--   users:*          – seat administration stays with the owner role itself
--   settings:write   – platform settings (the whole point of this migration)
--   tickets:triage   – triage is platform-only; clients raise, staff route
-- ------------------------------------------------------------
ALTER TABLE client_permission_overrides
  DROP CONSTRAINT IF EXISTS cpo_permission_is_client_safe;

ALTER TABLE client_permission_overrides
  ADD CONSTRAINT cpo_permission_is_client_safe CHECK (
    permission IN (
      'clients:read',
      'calls:read',
      'bookings:read', 'bookings:write',
      'analytics:read',
      'settings:read',
      'account:write',
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
  );

-- ------------------------------------------------------------
-- 3. Verification — abort rather than half-migrate
--
-- Same posture as 016 and 022: a partially applied permission migration either
-- locks people out or quietly opens something, both with no obvious cause.
-- ------------------------------------------------------------
DO $$
DECLARE
  owner_grant  INTEGER;
  admin_grant  INTEGER;
  super_grant  INTEGER;
  leaked       INTEGER;
  overreach    INTEGER;
BEGIN
  -- The three roles that must now hold it.
  SELECT COUNT(*) INTO owner_grant
  FROM permissions p JOIN roles r ON r.id = p.role_id
  WHERE r.name = 'client_owner' AND p.permission = 'account:write';
  IF owner_grant <> 1 THEN
    RAISE EXCEPTION 'Migration 037: client_owner must hold account:write exactly once (found %)', owner_grant;
  END IF;

  SELECT COUNT(*) INTO admin_grant
  FROM permissions p JOIN roles r ON r.id = p.role_id
  WHERE r.name = 'client_admin' AND p.permission = 'account:write';
  IF admin_grant <> 1 THEN
    RAISE EXCEPTION 'Migration 037: client_admin must hold account:write exactly once (found %)', admin_grant;
  END IF;

  -- Staff must not lose ground: they could edit a client profile before 037.
  SELECT COUNT(*) INTO super_grant
  FROM permissions p JOIN roles r ON r.id = p.role_id
  WHERE r.name = 'super_admin' AND p.permission = 'account:write';
  IF super_grant <> 1 THEN
    RAISE EXCEPTION 'Migration 037: super_admin lost account:write';
  END IF;

  -- The boundary this migration exists to PRESERVE. If splitting the grant
  -- somehow handed a tenant the platform one, the split has failed.
  SELECT COUNT(*) INTO leaked
  FROM permissions p JOIN roles r ON r.id = p.role_id
  WHERE r.scope = 'client'
    AND p.permission IN ('system:read', 'system:write', 'recordings:read',
                         'clients:write', 'settings:write', 'tickets:triage');
  IF leaked > 0 THEN
    RAISE EXCEPTION 'Migration 037: % platform-only grant(s) leaked to a client role', leaked;
  END IF;

  -- The read-only roles stay read-only.
  SELECT COUNT(*) INTO overreach
  FROM permissions p JOIN roles r ON r.id = p.role_id
  WHERE r.name IN ('client_manager', 'client_viewer') AND p.permission = 'account:write';
  IF overreach > 0 THEN
    RAISE EXCEPTION 'Migration 037: account:write reached a role that cannot open Settings';
  END IF;
END $$;

COMMENT ON CONSTRAINT cpo_permission_is_client_safe ON client_permission_overrides IS
  'The grants a tenant may hold. Keep in step with CLIENT_SAFE_PERMISSIONS in auth.types.ts; rbac-permissions.test.ts asserts they match.';
