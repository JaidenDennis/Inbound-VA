import { Worker, type Job } from 'bullmq';
import { redis } from '../queues/index.js';
import { logger } from '../utils/index.js';
import { provisioningService } from '../services/provisioning.service.js';
import { agentSyncService } from '../services/agentSync.service.js';

interface AgentProvisionJob {
  clientId: string;
  userId?: string;
}

/**
 * Pushes a client's current configuration to Retell.
 *
 * Runs on a delay so a burst of knowledge edits collapses into one provision
 * (see agentSync.service). Concurrency is 2: provisioning is a sequence of
 * Retell API calls, and running many at once buys little while making rate
 * limits and partial failures more likely.
 */
async function processAgentProvision(job: Job<AgentProvisionJob>): Promise<void> {
  const { clientId, userId } = job.data;

  // Validate before calling Retell. A malformed prompt rejected here leaves the
  // live agent untouched; pushed, it would degrade every call until noticed.
  const problems = await provisioningService.validateClient(clientId);
  if (problems.length > 0) {
    const message = problems.join('; ');
    await agentSyncService.markFailed(clientId, message);
    logger.error({ clientId, problems }, 'Agent provision blocked by validation');
    throw new Error(`Agent configuration is invalid: ${message}`);
  }

  try {
    const result = await provisioningService.provisionClient(clientId, { userId });
    logger.info({ clientId, agentId: result.agentId, version: result.version }, 'Agent re-provisioned');
  } catch (err) {
    // Surface the reason in the dashboard badge. The throw still marks the job
    // failed so the retry and the system-error capture both apply.
    await agentSyncService.markFailed(clientId, (err as Error).message);
    throw err;
  }
}

export function startAgentProvisioningWorker(): Worker {
  return new Worker('agent-provisioning', processAgentProvision, {
    connection: redis,
    concurrency: 2,
  });
}
