import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyError, FastifyRequest } from 'fastify';

/**
 * Task 3 (fix round 1): the Sentry event id must reach `systemErrorService.record`
 * at EVERY capture site, not just terminal queue-job failures. Each block below
 * mocks only what its capture site touches and asserts the id captured from
 * Sentry lands in the argument object passed to `record`.
 *
 * These use `vi.doMock` (not the hoisted `vi.mock`) because each describe block
 * needs its own independent spy for the SAME module path
 * (`../services/systemError.service.js`) within one test file — `vi.doMock` is
 * registered freshly right before each dynamic import so the three blocks don't
 * clobber each other's mock.
 */

describe('sentry event id wiring', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Site 1: backend/src/utils/request-error.ts — extracted out of app.ts's 500
  // handler so it can be exercised without booting the whole Fastify app.
  // -------------------------------------------------------------------------
  describe('recordRequestError (app.ts 500 path)', () => {
    function fakeRequest(): FastifyRequest {
      return {
        id: 'req-1',
        url: '/clients/123',
        method: 'GET',
        params: {},
        query: {},
        routeOptions: { url: '/clients/:id' },
      } as unknown as FastifyRequest;
    }

    it('forwards the captured Sentry event id into the persisted row', async () => {
      const recordSpy = vi.fn(async () => 'row-1');
      vi.doMock('../services/systemError.service.js', () => ({
        systemErrorService: { record: recordSpy },
        fingerprintFor: () => 'fp-app',
      }));
      vi.doMock('../services/systemAlert.service.js', () => ({
        systemAlertService: { maybeOpenTicket: vi.fn(async () => null) },
      }));

      const { recordRequestError } = await import('../utils/request-error.js');
      const error = Object.assign(new Error('boom'), { statusCode: 500 }) as FastifyError;

      await recordRequestError(fakeRequest(), error, 500, 'evt-app-1');

      expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({ sentryEventId: 'evt-app-1' }));
    });

    it('passes null through untouched when Sentry produced no id', async () => {
      const recordSpy = vi.fn(async () => 'row-1');
      vi.doMock('../services/systemError.service.js', () => ({
        systemErrorService: { record: recordSpy },
        fingerprintFor: () => 'fp-app',
      }));
      vi.doMock('../services/systemAlert.service.js', () => ({
        systemAlertService: { maybeOpenTicket: vi.fn(async () => null) },
      }));

      const { recordRequestError } = await import('../utils/request-error.js');
      const error = Object.assign(new Error('boom'), { statusCode: 500 }) as FastifyError;

      await recordRequestError(fakeRequest(), error, 500, null);

      expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({ sentryEventId: null }));
    });
  });

  // -------------------------------------------------------------------------
  // Site 2: backend/src/utils/fatal-handlers.ts — captureException and
  // systemErrorService.record are called in the SAME function (`recordFatal`),
  // the pattern the original brief mistakenly attributed to failure-alerts.ts.
  // -------------------------------------------------------------------------
  describe('fatal-handlers (process-level faults)', () => {
    it('threads the Sentry event id from captureException into record()', async () => {
      const captureExceptionMock = vi.fn(() => 'evt-fatal-1');
      const recordSpy = vi.fn(async () => 'row-2');
      vi.doMock('../utils/sentry.js', () => ({ captureException: captureExceptionMock }));
      vi.doMock('../services/systemError.service.js', () => ({
        systemErrorService: { record: recordSpy },
      }));

      const { installFatalHandlers } = await import('../utils/fatal-handlers.js');
      installFatalHandlers('api');

      process.emit('unhandledRejection', new Error('boom'), Promise.resolve());

      await vi.waitFor(() => expect(recordSpy).toHaveBeenCalled());
      expect(captureExceptionMock).toHaveBeenCalled();
      expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({ sentryEventId: 'evt-fatal-1' }));
    });
  });

  // -------------------------------------------------------------------------
  // Site 3: backend/src/workers/failure-alerts.ts — the site the original
  // brief (correctly) scoped, kept here so all three sites are covered
  // together and the same threading contract is asserted identically.
  // -------------------------------------------------------------------------
  describe('failure-alerts (terminal queue-job failures)', () => {
    it('threads the Sentry event id from captureException into record()', async () => {
      const captureExceptionMock = vi.fn(() => 'evt-worker-1');
      const recordSpy = vi.fn(async () => 'row-3');
      const failedJobInsert = vi.fn(async () => ({ error: null }));

      vi.doMock('../db/index.js', () => ({
        supabase: { from: () => ({ insert: failedJobInsert }) },
      }));
      vi.doMock('../utils/index.js', () => ({
        logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), fatal: vi.fn() },
        captureException: captureExceptionMock,
        sendMail: vi.fn(async () => undefined),
      }));
      vi.doMock('../services/systemError.service.js', () => ({
        systemErrorService: { record: recordSpy },
        fingerprintFor: () => 'fp-worker',
      }));
      vi.doMock('../services/systemAlert.service.js', () => ({
        systemAlertService: { maybeOpenTicket: vi.fn(async () => null) },
      }));

      const { onFinalFailure } = await import('../workers/failure-alerts.js');
      const job = {
        id: 'j-1',
        attemptsMade: 3,
        opts: { attempts: 3 },
        data: { kind: 'test' },
      } as unknown as import('bullmq').Job;

      await onFinalFailure('test-queue', job, new Error('exhausted'));

      expect(captureExceptionMock).toHaveBeenCalled();
      expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({ sentryEventId: 'evt-worker-1' }));
    });
  });
});
