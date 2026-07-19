import { Worker, type Job } from 'bullmq';
import { redis } from '../queues/index.js';
import { supabase } from '../db/index.js';
import { getCrmAdapter, resolveAdapterConfig, type ICrmAdapter } from '../crm/index.js';
import { logger } from '../utils/index.js';
import type { CrmSyncJobData } from '../types/index.js';

/**
 * Resolve the CRM's own ID for a contact so appointments/notes attach to the
 * right person inside the CRM (not our internal UUID).
 *
 *  - If we already stored the CRM id on the contact, use it.
 *  - Otherwise sync the contact to the CRM now, save the returned id, and use it.
 *  - Forwarder-style adapters (e.g. generic webhook) may not return an id —
 *    in that case fall back to the internal id so a consistent reference is sent.
 */
export async function resolveCrmContactId(
  adapter: ICrmAdapter,
  clientId: string,
  internalContactId: string
): Promise<string> {
  const { data: contact } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', internalContactId)
    .eq('client_id', clientId)
    .maybeSingle();

  if (!contact) throw new Error(`Contact not found for CRM sync: ${internalContactId}`);
  if (contact.external_crm_id) return contact.external_crm_id;

  const res = await adapter.createOrUpdateContact({
    firstName: contact.first_name,
    lastName: contact.last_name,
    email: contact.email ?? undefined,
    phone: contact.phone,
    customFields: (contact.custom_fields as Record<string, unknown>) ?? undefined,
  });

  if (!res.success) {
    throw new Error(res.error ?? 'Failed to sync CRM contact before linking');
  }
  if (res.externalId) {
    await supabase
      .from('contacts')
      .update({ external_crm_id: res.externalId })
      .eq('id', internalContactId)
      .eq('client_id', clientId);
    return res.externalId;
  }
  return internalContactId; // forwarder adapter with no id — use internal reference
}

async function processCrmSync(job: Job<CrmSyncJobData>): Promise<void> {
  const { clientId, crmConnectionId, entityType, entityId, operation, payload } = job.data;

  // Load CRM connection
  const { data: conn, error } = await supabase
    .from('crm_connections')
    .select('*')
    .eq('id', crmConnectionId)
    .eq('client_id', clientId)
    .single();

  if (error || !conn) throw new Error(`CRM connection not found: ${crmConnectionId}`);

  // Decrypt + merge connection settings; refreshes OAuth tokens (GHL) if the
  // access token is at/near expiry.
  const adapter = getCrmAdapter(conn.crm_type, await resolveAdapterConfig(conn));

  let result;
  switch (entityType) {
    case 'contact': {
      result = await adapter.createOrUpdateContact(payload as never);
      // Persist the CRM's id back on the contact so future appointments/notes
      // can attach to the right person.
      if (result.success && result.externalId) {
        await supabase
          .from('contacts')
          .update({ external_crm_id: result.externalId })
          .eq('id', entityId)
          .eq('client_id', clientId);
      }
      break;
    }
    case 'lead':
      result = await adapter.createLead(payload as never);
      break;
    case 'appointment': {
      // Dates are serialized to ISO strings across the queue boundary;
      // adapters expect real Date objects, so coerce them back. Also swap the
      // internal contact id for the CRM's own contact id.
      const appt = payload as Record<string, unknown>;
      const crmContactId = await resolveCrmContactId(adapter, clientId, appt.contactId as string);
      result = await adapter.createAppointment({
        ...appt,
        contactId: crmContactId,
        startTime: new Date(appt.startTime as string),
        endTime: new Date(appt.endTime as string),
      } as never);
      break;
    }
    case 'transcript': {
      const crmContactId = await resolveCrmContactId(adapter, clientId, payload.contactId as string);
      result = await adapter.pushTranscript(
        crmContactId,
        payload.transcript as string,
        payload.callId as string
      );
      break;
    }
    case 'note': {
      const crmContactId = await resolveCrmContactId(adapter, clientId, payload.contactId as string);
      result = await adapter.createNote({
        contactId: crmContactId,
        body: payload.body as string,
        // createdAt is serialized to a string across the queue boundary.
        createdAt: new Date((payload.createdAt as string) ?? Date.now()),
      });
      break;
    }
    case 'summary': {
      const crmContactId = await resolveCrmContactId(adapter, clientId, payload.contactId as string);
      result = await adapter.pushCallSummary(
        crmContactId,
        payload.summary as string,
        payload.callId as string
      );
      break;
    }
    default:
      throw new Error(`Unknown entity type: ${entityType}`);
  }

  const logStatus = result.success ? 'success' : 'failed';

  await supabase.from('crm_sync_logs').upsert({
    client_id: clientId,
    crm_connection_id: crmConnectionId,
    entity_type: entityType,
    entity_id: entityId,
    operation,
    status: logStatus,
    external_id: result.externalId ?? null,
    error_message: result.error ?? null,
    attempts: job.attemptsMade + 1,
  }, { onConflict: 'client_id,entity_type,entity_id,operation' });

  if (!result.success) throw new Error(result.error ?? 'CRM sync failed');

  logger.info({ jobId: job.id, entityType, entityId, clientId }, 'CRM sync complete');
}

export function startCrmSyncWorker(): Worker<CrmSyncJobData> {
  // Terminal-failure handling (failed_jobs + alerts) is wired centrally for all
  // queues in workers/index.ts via onFinalFailure.
  return new Worker<CrmSyncJobData>('crm-sync', processCrmSync, {
    connection: redis,
    concurrency: 5,
  });
}
