import { eventBus } from '../events/index.js';
import { logger } from '../utils/index.js';
import { handleCallSummaryCompleted, handleBookingRequested } from './post-call.automation.js';

let registered = false;

/**
 * Subscribe post-call automation to the in-process event bus. Idempotent and
 * safe to call from BOTH the API and worker processes — events are emitted in
 * whichever process performs the action, and follow-up jobs use idempotent
 * jobIds so duplicates collapse.
 */
export function registerAutomationSubscribers(): void {
  if (registered) return;
  registered = true;
  eventBus.subscribe('call.summary.completed', (e) => void handleCallSummaryCompleted(e));
  eventBus.subscribe('booking.requested', (e) => void handleBookingRequested(e));
  logger.info('Post-call automation subscribers registered');
}

export { handleCallSummaryCompleted, handleBookingRequested };
