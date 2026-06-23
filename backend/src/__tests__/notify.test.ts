import { describe, it, expect, vi, beforeEach } from 'vitest';

// Isolate the notify module from real config/logger so we can drive the channel
// selection and assert the outbound HTTP shapes without network or env coupling.
const mockEnv = vi.hoisted(() => ({
  env: {
    NOTIFY_CHANNEL: 'telegram' as 'telegram' | 'discord',
    TELEGRAM_BOT_TOKEN: 'BOT123' as string | undefined,
    TELEGRAM_CHAT_ID: 'CHAT456' as string | undefined,
    DISCORD_WEBHOOK_URL: 'https://discord.test/webhook' as string | undefined,
    DASHBOARD_URL: 'https://dash.test',
  },
}));
vi.mock('../config/index.js', () => ({ env: mockEnv.env }));
vi.mock('../utils/index.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { notify, toTelegramPayload, toDiscordPayload } from '../notify/index.js';

const sampleMessage = {
  title: '🎫 New support ticket',
  fields: [
    { label: 'Client', value: 'Acme Dental' },
    { label: 'Subject', value: 'Phone line down' },
    { label: 'Priority', value: 'urgent' },
  ],
  url: 'https://dash.test/dashboard/support/t-1',
};

describe('notify payload shapes', () => {
  it('formats a Telegram sendMessage body (HTML, escaped, with link)', () => {
    const p = toTelegramPayload({
      title: 'A & B',
      fields: [{ label: 'X', value: '<b>v</b>' }],
      url: 'https://dash.test/x',
    });
    expect(p.parse_mode).toBe('HTML');
    expect(p.disable_web_page_preview).toBe(true);
    expect(p.text).toContain('<b>A &amp; B</b>');
    expect(p.text).toContain('X: <b>&lt;b&gt;v&lt;/b&gt;</b>'); // value HTML-escaped
    expect(p.text).toContain('<a href="https://dash.test/x">View in dashboard</a>');
  });

  it('formats a Discord webhook body (markdown content)', () => {
    const p = toDiscordPayload(sampleMessage);
    expect(p.content).toContain('**🎫 New support ticket**');
    expect(p.content).toContain('Client: **Acme Dental**');
    expect(p.content).toContain('https://dash.test/dashboard/support/t-1');
  });
});

describe('notify() transport', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockEnv.env.NOTIFY_CHANNEL = 'telegram';
    mockEnv.env.TELEGRAM_BOT_TOKEN = 'BOT123';
    mockEnv.env.TELEGRAM_CHAT_ID = 'CHAT456';
    mockEnv.env.DISCORD_WEBHOOK_URL = 'https://discord.test/webhook';
  });

  it('POSTs to the Telegram Bot API with chat_id when configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);

    const ok = await notify(sampleMessage);

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/botBOT123/sendMessage');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.chat_id).toBe('CHAT456');
    expect(body.parse_mode).toBe('HTML');
    expect(body.text).toContain('New support ticket');
  });

  it('POSTs to the Discord webhook when NOTIFY_CHANNEL=discord (no other change)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    mockEnv.env.NOTIFY_CHANNEL = 'discord';

    const ok = await notify(sampleMessage);

    expect(ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://discord.test/webhook');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.content).toContain('New support ticket');
  });

  it('skips (returns false, no HTTP) when the channel is unconfigured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mockEnv.env.TELEGRAM_BOT_TOKEN = undefined;

    const ok = await notify(sampleMessage);

    expect(ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws and returns false when the send fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(notify(sampleMessage)).resolves.toBe(false);
  });
});
