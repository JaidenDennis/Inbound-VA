-- ============================================================
-- GRAVVIA ENGAGE – Seed default roles
-- Run order: 003
-- ============================================================

INSERT INTO roles (name, description) VALUES
  ('super_admin', 'Full platform access'),
  ('admin', 'Client admin with full client access'),
  ('agent', 'Operational agent with limited write access'),
  ('viewer', 'Read-only access')
ON CONFLICT (name) DO NOTHING;

-- Seed permissions for super_admin
INSERT INTO permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
CROSS JOIN (VALUES
  ('clients:read'), ('clients:write'),
  ('calls:read'), ('calls:write'),
  ('bookings:read'), ('bookings:write'),
  ('crm:read'), ('crm:write'),
  ('analytics:read'),
  ('settings:read'), ('settings:write'),
  ('users:read'), ('users:write')
) AS p(permission)
WHERE r.name = 'super_admin'
ON CONFLICT (role_id, permission) DO NOTHING;

-- admin
INSERT INTO permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
CROSS JOIN (VALUES
  ('clients:read'), ('clients:write'),
  ('calls:read'), ('calls:write'),
  ('bookings:read'), ('bookings:write'),
  ('crm:read'), ('crm:write'),
  ('analytics:read'),
  ('settings:read'), ('settings:write'),
  ('users:read')
) AS p(permission)
WHERE r.name = 'admin'
ON CONFLICT (role_id, permission) DO NOTHING;

-- agent
INSERT INTO permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
CROSS JOIN (VALUES
  ('clients:read'),
  ('calls:read'),
  ('bookings:read'), ('bookings:write'),
  ('crm:read'),
  ('analytics:read')
) AS p(permission)
WHERE r.name = 'agent'
ON CONFLICT (role_id, permission) DO NOTHING;

-- viewer
INSERT INTO permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
CROSS JOIN (VALUES
  ('clients:read'),
  ('calls:read'),
  ('bookings:read'),
  ('analytics:read')
) AS p(permission)
WHERE r.name = 'viewer'
ON CONFLICT (role_id, permission) DO NOTHING;
