import { Worker, type Job } from 'bullmq';
import { redis } from '../queues/index.js';
import { supabase } from '../db/index.js';
import { crmSyncQueue } from '../queues/index.js';
import { buildIdempotencyKey } from '../utils/index.js';
import { logger } from '../utils/index.js';
import type { CallProcessingJobData } from '../types/index.js';

async function processCall(job: Job<CallProcessingJobData>): Promise<void> {
  const { clientId, callId } = job.data;

  // Update call status
  await supabase.from('calls').update({ status: 'completed' }).eq('id', callId);

  // Get client CRM config
  const { data: conn } = await supabase
    .from('crm_connections')
    .select('id, crm_type')
    .eq('client_id', clientId)
    .eq('is_active', true)
    .single();

  if (!conn) {
    logger.info({ callId }, 'No active CRM connection – skipping sync');
    return;
  }

  // Load conversation to determine what to sync
  const { data: conversation } = await supabase
    .from('conversations')
    .select('*, contacts(*)')
    .eq('call_id', callId)
    .single();

  if (!conversation) return;

  if (conversation.contact_id) {
    // Map the DB contact row to the CRM adapter's expected shape (camelCase).
    const c = (conversation.contacts ?? {}) as Record<string, unknown>;
    await crmSyncQueue.add(
      'sync-contact',
      {
        clientId,
        crmConnectionId: conn.id,
        entityType: 'contact',
        entityId: conversation.contact_id,
        operation: 'update',
        payload: {
          firstName: (c.first_name as string) ?? '',
          lastName: (c.last_name as string) ?? '',
          email: (c.email as string) ?? undefined,
          phone: (c.phone as string) ?? '',
          customFields: (c.custom_fields as Record<string, unknown>) ?? undefined,
        },
        idempotencyKey: buildIdempotencyKey('contact', conversation.contact_id, callId),
      },
      { jobId: buildIdempotencyKey('crm-contact', callId) }
    );
  }

  logger.info({ jobId: job.id, callId, clientId }, 'Call processing complete');
}

export function startCallProcessingWorker(): Worker<CallProcessingJobData> {
  return new Worker<CallProcessingJobData>('call-processing', processCall, {
    connection: redis,
    concurrency: 10,
  });
}
