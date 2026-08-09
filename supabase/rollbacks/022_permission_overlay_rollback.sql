-- ============================================================
-- ROLLBACK for 022_permission_overlay.sql
--
-- Written up front, per the convention 016 established: a permission migration
-- that cannot be reversed is a permission migration nobody dares apply.
--
-- ORDER MATTERS. Users must be moved off client_admin BEFORE the role row and
-- its grants are removed, or the users_role_check re-add fails and leaves the
-- table without a role constraint at all.
--
-- NOT REVERSIBLE: overlay rows are deleted, not archived. If a tenant has been
-- given a bespoke grant set through the dashboard, snapshot
-- client_permission_overrides before running this.
-- ============================================================

-- 1. Move any client_admin users down to client_manager.
--
-- Down, not up: client_manager is the nearest role that is strictly LESS
-- privileged, and a rollback must never leave someone holding more access than
-- they started with. They lose knowledge/agent/crm write; they keep their seat.
UPDATE users SET role = 'client_manager' WHERE role = 'client_admin';

-- 2. Drop the overlay table.
DROP TABLE IF EXISTS client_permission_overrides;

-- 3. Remove the grants added by 022.
--
-- Scoped per role so a grant that predates 022 is not swept up with it.
DELETE FROM permissions p
USING roles r
WHERE p.role_id = r.id
  AND (
    -- Vocabulary added by 022: safe to remove everywhere, nothing else uses it.
    p.permission IN ('flags:read', 'flags:write',
                     'callbacks:read', 'callbacks:write',
                     'exports:read',
                     'configure:roles', 'configure:alerts')
    -- Pre-existing grants that 022 newly extended to client_owner. 016 gave
    -- client_owner neither agents:* nor crm:*, so removing them here restores
    -- the 016 state exactly.
    OR (r.name = 'client_owner'
        AND p.permission IN ('agents:read', 'agents:write', 'crm:read', 'crm:write'))
  );

-- 4. Drop the role row and restore 016's user constraint.
DELETE FROM permissions WHERE role_id = (SELECT id FROM roles WHERE name = 'client_admin');
DELETE FROM roles WHERE name = 'client_admin';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
  role IN ('super_admin', 'support_agent', 'analyst',
           'client_owner', 'client_manager', 'client_viewer')
);

-- 5. Verify we landed back on 016's invariants.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE role = 'client_admin') THEN
    RAISE EXCEPTION 'Rollback 022: users still hold client_admin';
  END IF;
  IF EXISTS (SELECT 1 FROM roles WHERE name = 'client_admin') THEN
    RAISE EXCEPTION 'Rollback 022: client_admin role row still present';
  END IF;
  IF EXISTS (
    SELECT 1 FROM permissions
    WHERE permission IN ('flags:read', 'flags:write', 'callbacks:read',
                         'callbacks:write', 'exports:read',
                         'configure:roles', 'configure:alerts')
  ) THEN
    RAISE EXCEPTION 'Rollback 022: 022-era grants survive';
  END IF;
  IF EXISTS (
    SELECT 1 FROM roles r LEFT JOIN permissions p ON p.role_id = r.id
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Rollback 022: a role was left with zero permissions';
  END IF;
END $$;

DELETE FROM schema_migrations WHERE version = '022';
