import { supabase } from '../db/index.js';
import type { CrmConnection } from '../types/index.js';

/** The client's active GoHighLevel connection, or null if never installed. */
export async function activeGhlConnection(clientId: string): Promise<CrmConnection | null> {
  const { data } = await supabase
    .from('crm_connections')
    .select('*')
    .eq('client_id', clientId)
    .eq('crm_type', 'gohighlevel')
    .eq('is_active', true)
    .maybeSingle();
  return (data as CrmConnection | null) ?? null;
}
