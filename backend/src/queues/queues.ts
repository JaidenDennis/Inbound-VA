import { Queue, QueueEvents } from 'bullmq';
import { redis } from './redis.js';
import type {
  CrmSyncJob, BookingJobData, NotificationJobData,
  CallProcessingJobData, TranscriptProcessingJobData, AnalyticsJobData,
} from '../types/index.js';

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: false,
};

// Carries entity sync jobs plus 'provision' blueprint jobs (CrmSyncJob union).
export const crmSyncQueue = new Queue<CrmSyncJob>('crm-sync', {
  connection: redis,
  defaultJobOptions,
});

export const bookingQueue = new Queue<BookingJobData>('booking', {
  connection: redis,
  defaultJobOptions,
});

export const notificationsQueue = new Queue<NotificationJobData>('notifications', {
  connection: redis,
  defaultJobOptions,
});

export const callProcessingQueue = new Queue<CallProcessingJobData>('call-processing', {
  connection: redis,
  defaultJobOptions,
});

export const transcriptProcessingQueue = new Queue<TranscriptProcessingJobData>('transcript-processing', {
  connection: redis,
  defaultJobOptions,
});

export const analyticsQueue = new Queue<AnalyticsJobData>('analytics', {
  connection: redis,
  defaultJobOptions: { ...defaultJobOptions, attempts: 1 },
});

/**
 * Re-provisions a client's Retell agent after a knowledge or config change.
 *
 * Jobs are added with a fixed jobId per client and a delay, which coalesces a
 * burst of edits into one sync: the first write schedules the run, later writes
 * within the window are dropped as duplicates. Deliberately coalescing rather
 * than true debouncing — a continuously-edited client would otherwise never
 * sync, and a guaranteed upper bound matters more than batching perfectly.
 *
 * attempts is 2, not 3: a failing provision is usually a config problem that
 * retrying cannot fix, and the failure needs to reach the dashboard quickly.
 */
export const agentProvisioningQueue = new Queue<{ clientId: string; userId?: string }>(
  'agent-provisioning',
  {
    connection: redis,
    defaultJobOptions: {
      ...defaultJobOptions,
      attempts: 2,
      removeOnComplete: { count: 200 },
    },
  }
);

// Internal housekeeping (daily retention purge). No payload; not tenant-scoped.
export const maintenanceQueue = new Queue<Record<string, never>>('maintenance', {
  connection: redis,
  defaultJobOptions: { attempts: 1, removeOnComplete: { count: 30 }, removeOnFail: { count: 30 } },
});

export const allQueues = [
  crmSyncQueue,
  bookingQueue,
  notificationsQueue,
  callProcessingQueue,
  transcriptProcessingQueue,
  analyticsQueue,
  agentProvisioningQueue,
  maintenanceQueue,
];

export const crmSyncEvents = new QueueEvents('crm-sync', { connection: redis });
export const bookingEvents = new QueueEvents('booking', { connection: redis });
