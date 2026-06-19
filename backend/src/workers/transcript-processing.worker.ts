import { Worker, type Job } from 'bullmq';
import { redis } from '../queues/index.js';
import { supabase } from '../db/index.js';
import { crmSyncQueue } from '../queues/index.js';
import { buildIdempotencyKey } from '../utils/index.js';
import { logger } from '../utils/index.js';
import type { TranscriptProcessingJobData } from '../types/index.js';

async function processTranscript(job: Job<TranscriptProcessingJobData>): Promise<void> {
  const { clientId, callId, transcript } = job.data;

  const wordCount = transcript.reduce((acc, t) => acc + t.content.split(' ').length, 0);
  const fullText = transcript.map((t) => `[${t.role.toUpperCase()}]: ${t.content}`).join('\n');

  // Upsert transcript record
  await supabase.from('call_transcripts').upsert({
    call_id: callId,
    client_id: clientId,
    transcript,
    word_count: wordCount,
  }, { onConflict: 'call_id' });

  // Get conversation contact
  const { data: conversation } = await supabase
    .from('conversations')
    .select('contact_id')
    .eq('call_id', callId)
    .single();

  const contactId = conversation?.contact_id;

  if (!contactId) {
    logger.info({ callId }, 'No contact to push transcript to');
    return;
  }

  // Queue CRM push
  const { data: conn } = await supabase
    .from('crm_connections')
    .select('id')
    .eq('client_id', clientId)
    .eq('is_active', true)
    .single();

  if (conn) {
    await crmSyncQueue.add(
      'push-transcript',
      {
        clientId,
        crmConnectionId: conn.id,
        entityType: 'transcript',
        entityId: callId,
        operation: 'create',
        payload: { contactId, transcript: fullText, callId },
        idempotencyKey: buildIdempotencyKey('transcript', callId),
      },
      { jobId: buildIdempotencyKey('crm-transcript', callId) }
    );
  }

  logger.info({ jobId: job.id, callId, wordCount }, 'Transcript processing complete');
}

export function startTranscriptProcessingWorker(): Worker<TranscriptProcessingJobData> {
  return new Worker<TranscriptProcessingJobData>('transcript-processing', processTranscript, {
    connection: redis,
    concurrency: 5,
  });
}
