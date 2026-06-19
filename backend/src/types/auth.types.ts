export type UserRole = 'super_admin' | 'admin' | 'agent' | 'viewer';
export type Permission =
  | 'clients:read'
  | 'clients:write'
  | 'calls:read'
  | 'calls:write'
  | 'bookings:read'
  | 'bookings:write'
  | 'crm:read'
  | 'crm:write'
  | 'analytics:read'
  | 'settings:read'
  | 'settings:write'
  | 'users:read'
  | 'users:write';

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  super_admin: [
    'clients:read', 'clients:write', 'calls:read', 'calls:write',
    'bookings:read', 'bookings:write', 'crm:read', 'crm:write',
    'analytics:read', 'settings:read', 'settings:write', 'users:read', 'users:write',
  ],
  admin: [
    'clients:read', 'clients:write', 'calls:read', 'calls:write',
    'bookings:read', 'bookings:write', 'crm:read', 'crm:write',
    'analytics:read', 'settings:read', 'settings:write', 'users:read',
  ],
  agent: [
    'clients:read', 'calls:read', 'bookings:read', 'bookings:write',
    'crm:read', 'analytics:read',
  ],
  viewer: ['clients:read', 'calls:read', 'bookings:read', 'analytics:read'],
};

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  client_id: string | null;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  clientId: string | null;
  iat: number;
  exp: number;
}

export interface ApiKey {
  id: string;
  client_id: string;
  name: string;
  key_hash: string;
  permissions: Permission[];
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}
