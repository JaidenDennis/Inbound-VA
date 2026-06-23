import { env } from '../config/index.js';
import { logger } from '../utils/index.js';

/**
 * Pluggable outbound notification module. v1 sends to Telegram; set
 * NOTIFY_CHANNEL=discord (+ DISCORD_WEBHOOK_URL) to switch to Discord with NO
 * other code change. Best-effort by design: notify() never throws and a
 * down/unconfigured channel is a logged skip — callers (e.g. ticket creation)
 * must not fail because the alert channel is unavailable.
 */
export interface NotifyMessage {
  title: string;
  fields: Array<{ label: string; value: string }>;
  url?: string;
}

const TIMEOUT_MS = 5_000;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Telegram Bot API sendMessage body (minus chat_id, added at send time). */
export function toTelegramPayload(m: NotifyMessage): {
  text: string;
  parse_mode: 'HTML';
  disable_web_page_preview: boolean;
} {
  const lines = [
    `<b>${escapeHtml(m.title)}</b>`,
    ...m.fields.map((f) => `${escapeHtml(f.label)}: <b>${escapeHtml(f.value)}</b>`),
  ];
  if (m.url) lines.push(`\n<a href="${escapeHtml(m.url)}">View in dashboard</a>`);
  return { text: lines.join('\n'), parse_mode: 'HTML', disable_web_page_preview: true };
}

/** Discord webhook body. */
export function toDiscordPayload(m: NotifyMessage): { content: string } {
  const lines = [
    `**${m.title}**`,
    ...m.fields.map((f) => `${f.label}: **${f.value}**`),
  ];
  if (m.url) lines.push(m.url);
  return { content: lines.join('\n') };
}

async function postJson(url: string, body: unknown): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send a notification to the configured channel. Returns true on a successful
 * send, false when skipped (unconfigured) or failed. Never throws.
 */
export async function notify(message: NotifyMessage): Promise<boolean> {
  const channel = env.NOTIFY_CHANNEL;
  try {
    if (channel === 'discord') {
      if (!env.DISCORD_WEBHOOK_URL) {
        logger.warn('NOTIFY_CHANNEL=discord but DISCORD_WEBHOOK_URL is unset — notification skipped');
        return false;
      }
      await postJson(env.DISCORD_WEBHOOK_URL, toDiscordPayload(message));
    } else {
      if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
        logger.warn('Telegram not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID unset) — notification skipped');
        return false;
      }
      await postJson(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: env.TELEGRAM_CHAT_ID,
        ...toTelegramPayload(message),
      });
    }
    return true;
  } catch (err) {
    logger.error({ err, channel }, 'notify failed — continuing without alert');
    return false;
  }
}
