-- ============================================================
-- ROLLBACK for migration 016_rbac_role_families.sql
--
-- Not run automatically. Apply by hand only if 016 has to be reverted.
--
-- LOSSY: the forward migration collapsed information. Both `admin` and
-- `super_admin` platform users became `support_agent`, so rolling back returns
-- every platform staff member except a pre-existing super_admin to `admin`.
-- Re-promote by hand afterwards:
--     UPDATE users SET role = 'super_admin' WHERE email = '...';
-- ============================================================

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

UPDATE users SET role = CASE
  WHEN role = 'super_admin'    THEN 'super_admin'
  WHEN role = 'support_agent'  THEN 'admin'
  WHEN role = 'analyst'        THEN 'viewer'
  WHEN role = 'client_owner'   THEN 'admin'
  WHEN role = 'client_manager' THEN 'agent'
  WHEN role = 'client_viewer'  THEN 'viewer'
  ELSE role
END;

ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
  role IN ('super_admin', 'admin', 'agent', 'viewer')
);

DELETE FROM permissions;
DELETE FROM roles WHERE name IN ('support_agent', 'analyst', 'client_owner', 'client_manager', 'client_viewer');

ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_scope_check;
ALTER TABLE roles DROP COLUMN IF EXISTS scope;

INSERT INTO roles (name, description) VALUES
  ('admin',  'Client admin with full client access'),
  ('agent',  'Operational agent with limited write access'),
  ('viewer', 'Read-only access')
ON CONFLICT (name) DO NOTHING;

-- Permissions are left empty on purpose: before 016 the table was unused at
-- runtime (the hardcoded ROLE_PERMISSIONS map in auth.types.ts was authoritative),
-- so reverting the code restores the old behaviour without needing these rows.
-- Re-run 003_seed_roles.sql if you want the historical seed data back.
