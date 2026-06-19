import { supabase } from '../db/index.js';

interface AuditEntry {
  userId?: string;
  clientId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string;
  userAgent?: string;
}

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  await supabase.from('audit_logs').insert({
    user_id: entry.userId ?? null,
    client_id: entry.clientId ?? null,
    action: entry.action,
    entity_type: entry.entityType ?? null,
    entity_id: entry.entityId ?? null,
    old_value: entry.oldValue ? JSON.parse(JSON.stringify(entry.oldValue)) : null,
    new_value: entry.newValue ? JSON.parse(JSON.stringify(entry.newValue)) : null,
    ip_address: entry.ipAddress ?? null,
    user_agent: entry.userAgent ?? null,
  });
}
