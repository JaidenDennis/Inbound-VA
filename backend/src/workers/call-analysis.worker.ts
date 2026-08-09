import { Worker, type Job } from 'bullmq';
import { redis } from '../queues/index.js';
import { analyzeAndStore } from '../ai/call-quality.service.js';
import { isAiConfigured } from '../ai/claude.client.js';
import { logger } from '../utils/index.js';

export interface CallAnalysisJobData {
  callId: string;
  clientId: string;
}

/**
 * Score one call and record any knowledge gaps it revealed.
 *
 * Enqueued from the transcript webhook rather than call-ended: the pass needs a
 * transcript, and enqueueing before one exists would burn an attempt on every
 * call and then quietly give up.
 */
async function processCallAnalysis(job: Job<CallAnalysisJobData>): Promise<void> {
  const { callId, clientId } = job.data;

  // Belt and braces alongside not registering the worker at all — a deployment
  // that loses its key mid-run should stop cleanly, not fail every job.
  if (!isAiConfigured()) {
    logger.debug({ callId }, 'AI not configured — skipping call analysis');
    return;
  }

  const quality = await analyzeAndStore(callId);

  if (!quality) {
    // Not an error. No transcript yet, already analysed, or the model returned
    // something unusable. The call stays unanalysed and counts against coverage,
    // which is the honest outcome — see report_quality in migration 023.
    logger.info({ callId, clientId }, 'call analysis produced no score');
    return;
  }

  logger.info(
    { callId, clientId, score: quality.score, flags: quality.flagReasons, gaps: quality.unansweredQuestions.length },
    'call analysis complete'
  );
}

/**
 * Concurrency 3, deliberately low.
 *
 * This worker is the only per-call model spend in the system. A backlog after an
 * incident should drain at a predictable rate rather than opening as many
 * concurrent model calls as Redis can hand out.
 */
export function startCallAnalysisWorker(): Worker<CallAnalysisJobData> {
  return new Worker<CallAnalysisJobData>('call-analysis', processCallAnalysis, {
    connection: redis,
    concurrency: 3,
  });
}
