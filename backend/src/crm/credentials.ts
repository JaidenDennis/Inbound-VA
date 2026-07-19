import { decrypt } from '../utils/index.js';
import { ensureFreshGhlCredentials } from './gohighlevel-oauth.service.js';
import type { CrmConnection } from '../types/index.js';

/**
 * Turn a crm_connections row into the flat config object adapters receive.
 *
 * OAuth-based CRMs (currently GoHighLevel) get token refresh here so adapters
 * stay stateless; static-credential CRMs just decrypt. Connection-level
 * settings (pipeline, stage/calendar selection, field mapping) are merged in
 * so adapters see a single config object.
 */
export async function resolveAdapterConfig(
  conn: Pick<
    CrmConnection,
    'id' | 'crm_type' | 'credentials_encrypted' | 'pipeline_id' | 'crm_config' | 'custom_field_mapping'
  >
): Promise<Record<string, unknown>> {
  const credentials =
    conn.crm_type === 'gohighlevel'
      ? { ...(await ensureFreshGhlCredentials(conn)) }
      : (JSON.parse(decrypt(conn.credentials_encrypted)) as Record<string, unknown>);

  return {
    ...credentials,
    ...(conn.crm_config ?? {}),
    ...(conn.pipeline_id ? { pipelineId: conn.pipeline_id } : {}),
    ...(conn.custom_field_mapping && Object.keys(conn.custom_field_mapping).length
      ? { customFieldMapping: conn.custom_field_mapping }
      : {}),
  };
}
