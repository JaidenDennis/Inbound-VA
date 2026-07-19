import { Worker, UnrecoverableError, type Job } from 'bullmq';
import { redis } from '../queues/index.js';
import { supabase } from '../db/index.js';
import { getCrmAdapter, resolveAdapterConfig, type ICrmAdapter } from '../crm/index.js';
import {
  ghlProvisioningService,
  markRunManualReview,
  loadProvisionRun,
} from '../crm/ghl-provisioning.service.js';
import { logger } from '../utils/index.js';
import type { CrmConnection, CrmProvisionJobData, CrmSyncJob, CrmSyncJobData } from '../types/index.js';

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

/**
 * GHL blueprint provisioning branch. The service persists per-step progress,
 * so a BullMQ retry of the same job resumes from the first incomplete step.
 * On the final attempt (or an UnrecoverableError from the service) the run
 * row is parked as manual_review; the generic onFinalFailure adds the
 * failed_jobs row + alert email.
 */
async function processProvisionJob(job: Job<CrmSyncJob>): Promise<void> {
  const { clientId, crmConnectionId, runId, blueprint, blueprintName } =
    job.data as CrmProvisionJobData;
  const attempt = job.attemptsMade + 1;
  const maxAttempts = job.opts.attempts ?? 1;

  const parkRun = async (message: string): Promise<void> => {
    // Load the persisted run so already-completed step detail survives the flip.
    const run = await loadProvisionRun(clientId, crmConnectionId, runId, blueprintName);
    await markRunManualReview(run, { attempts: attempt, errorMessage: message });
  };

  const { data: conn, error } = await supabase
    .from('crm_connections')
    .select('*')
    .eq('id', crmConnectionId)
    .eq('client_id', clientId)
    .single();

  if (error || !conn) {
    const message = `CRM connection not found: ${crmConnectionId}`;
    await parkRun(message);
    throw new UnrecoverableError(message);
  }
  if ((conn as CrmConnection).needs_reauth) {
    const message = 'Connection needs re-authorization — re-run the GHL install first';
    await parkRun(message);
    throw new UnrecoverableError(message);
  }

  try {
    await ghlProvisioningService.applyBlueprint({
      clientId,
      runId,
      blueprint,
      conn: conn as CrmConnection,
      attempt,
    });
  } catch (err) {
    // The service already persisted step state (and manual_review for 401s).
    // Here we only park runs whose retries are exhausted.
    if (!(err instanceof UnrecoverableError) && attempt >= maxAttempts) {
      await parkRun(err instanceof Error ? err.message : String(err));
    }
    throw err;
  }
}

export async function processCrmSync(job: Job<CrmSyncJob>): Promise<void> {
  if (job.name === 'provision' && 'kind' in job.data && job.data.kind === 'provision') {
    return processProvisionJob(job);
  }
  const { clientId, crmConnectionId, entityType, entityId, operation, payload } =
    job.data as CrmSyncJobData;

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

export function startCrmSyncWorker(): Worker<CrmSyncJob> {
  // Terminal-failure handling (failed_jobs + alerts) is wired centrally for all
  // queues in workers/index.ts via onFinalFailure.
  return new Worker<CrmSyncJob>('crm-sync', processCrmSync, {
    connection: redis,
    concurrency: 5,
  });
}
