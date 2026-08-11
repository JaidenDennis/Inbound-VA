import { describe, it, expect, vi, beforeEach } from 'vitest';

const recorded = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));
vi.mock('../services/systemError.service.js', () => ({
  systemErrorService: {
    record: vi.fn(async (input: Record<string, unknown>) => {
      recorded.calls.push(input);
      return 'err-1';
    }),
  },
}));

const transport = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock('nodemailer', () => ({
  default: { createTransport: () => transport },
  createTransport: () => transport,
}));

describe('sendMail visibility', () => {
  beforeEach(() => {
    recorded.calls.length = 0;
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('records ONE warning per process when SMTP is unconfigured, not one per send', async () => {
    vi.stubEnv('SMTP_PASS', '');
    const { sendMail, __resetMailerWarning } = await import('../utils/mailer.js');
    __resetMailerWarning();

    await sendMail({ to: 'a@example.com', subject: 'one' });
    await sendMail({ to: 'b@example.com', subject: 'two' });
    await sendMail({ to: 'c@example.com', subject: 'three' });

    expect(recorded.calls).toHaveLength(1);
    expect(recorded.calls[0]).toMatchObject({ source: 'email', severity: 'warn' });
    // Still a no-op: callers must not fail because mail is unconfigured.
    expect(transport.sendMail).not.toHaveBeenCalled();
  });

  it('records EVERY send failure, and still does not throw', async () => {
    vi.stubEnv('SMTP_PASS', 'a-real-looking-key');
    transport.sendMail.mockRejectedValue(
      new Error('Invalid login: 535 Authentication failed')
    );
    const { sendMail, __resetMailerWarning } = await import('../utils/mailer.js');
    __resetMailerWarning();

    await expect(sendMail({ to: 'a@example.com', subject: 'one' })).resolves.toBeUndefined();
    await expect(sendMail({ to: 'b@example.com', subject: 'two' })).resolves.toBeUndefined();

    expect(recorded.calls).toHaveLength(2);
    expect(recorded.calls[0]).toMatchObject({ source: 'email', severity: 'error' });
    expect(String((recorded.calls[0].error as Error).message)).toContain('535');
  });

  it('records nothing when the send succeeds', async () => {
    vi.stubEnv('SMTP_PASS', 'a-real-looking-key');
    transport.sendMail.mockResolvedValue({ messageId: 'x' });
    const { sendMail, __resetMailerWarning } = await import('../utils/mailer.js');
    __resetMailerWarning();

    await sendMail({ to: 'a@example.com', subject: 'one' });

    expect(recorded.calls).toHaveLength(0);
  });
});
