import { Worker, type Job } from 'bullmq';
import { redis } from '../queues/index.js';
import { bookingService } from '../booking/index.js';
import { logger } from '../utils/index.js';
import type { BookingJobData } from '../types/index.js';

async function processBooking(job: Job<BookingJobData>): Promise<void> {
  const { action, appointmentId, payload } = job.data;

  switch (action) {
    case 'create':
      await bookingService.createAppointment(payload as never);
      break;
    case 'cancel':
      if (!appointmentId) throw new Error('appointmentId required for cancel');
      await bookingService.cancelAppointment(appointmentId, payload.reason as string);
      break;
    case 'reschedule':
      if (!appointmentId) throw new Error('appointmentId required for reschedule');
      await bookingService.rescheduleAppointment({
        appointmentId,
        newStartTime: new Date(payload.newStartTime as string),
        newEndTime: new Date(payload.newEndTime as string),
        reason: payload.reason as string,
      });
      break;
    default:
      throw new Error(`Unknown booking action: ${action}`);
  }

  logger.info({ jobId: job.id, action }, 'Booking job complete');
}

export function startBookingWorker(): Worker<BookingJobData> {
  return new Worker<BookingJobData>('booking', processBooking, {
    connection: redis,
    concurrency: 5,
  });
}
