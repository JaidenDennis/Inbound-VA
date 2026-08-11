import { describe, it, expect, vi, beforeEach } from 'vitest';

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(() => 'abc123eventid'),
}));
vi.mock('@sentry/node', () => sentry);

describe('sentry correlation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns null when Sentry is not initialised, without calling the SDK', async () => {
    const { captureException } = await import('../utils/sentry.js');
    expect(captureException(new Error('boom'))).toBeNull();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('returns the event id once initialised', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://example@o0.ingest.sentry.io/0');
    vi.resetModules();
    const { initSentry, captureException } = await import('../utils/sentry.js');
    initSentry('api');

    expect(captureException(new Error('boom'), { clientId: 'c-1' })).toBe('abc123eventid');
    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ extra: { clientId: 'c-1' } })
    );
  });
});
