import { Queue, QueueEvents } from 'bullmq';
import { redis } from './redis.js';
import type {
  CrmSyncJobData, BookingJobData, NotificationJobData,
  CallProcessingJobData, TranscriptProcessingJobData, AnalyticsJobData,
} from '../types/index.js';

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: false,
};

export const crmSyncQueue = new Queue<CrmSyncJobData>('crm-sync', {
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
  maintenanceQueue,
];

export const crmSyncEvents = new QueueEvents('crm-sync', { connection: redis });
export const bookingEvents = new QueueEvents('booking', { connection: redis });
