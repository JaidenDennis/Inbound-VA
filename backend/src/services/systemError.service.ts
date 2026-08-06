import { createHash } from 'node:crypto';
import { supabase } from '../db/index.js';
import { logger } from '../utils/index.js';
import { redactContext, redactText } from '../utils/redact.js';

export type ErrorSource = 'api' | 'worker' | 'webhook' | 'startup';
export type ErrorSeverity = 'warn' | 'error' | 'fatal';

export interface RecordErrorInput {
  source: ErrorSource;
  severity?: ErrorSeverity;
  clientId?: string | null;
  requestId?: string | null;
  route?: string | null;
  method?: string | null;
  statusCode?: number | null;
  error: Error | { name?: string; message: string; stack?: string };
  context?: Record<string, unknown>;
}

/**
 * Strip the variable parts of a message so recurrences of the same fault hash
 * alike: UUIDs, numbers, quoted values, ISO timestamps and hex blobs all become
 * placeholders. Without this, "call 8f2e… failed" produces a distinct
 * fingerprint per call and the grouping is worthless.
 */
export function normalizeMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, '<timestamp>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<hex>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/'[^']*'/g, "'<v>'")
    .replace(/"[^"]*"/g, '"<v>"')
    .trim()
    .slice(0, 500);
}

export function fingerprintFor(input: {
  source: string;
  errorName: string;
  route?: string | null;
  message: string;
}): string {
  const basis = [input.source, input.errorName, input.route ?? '', normalizeMessage(input.message)].join('|');
  return createHash('sha256').update(basis).digest('hex').slice(0, 32);
}

export class SystemErrorService {
  /**
   * Persist one fault. Best-effort by design: this is called from error paths,
   * so a failure here must never mask or replace the original error.
   */
  async record(input: RecordErrorInput): Promise<string | null> {
    const errorName = input.error.name || 'Error';
    const message = redactText(input.error.message || 'Unknown error');
    const stack = input.error.stack ? redactText(input.error.stack) : null;
    const fingerprint = fingerprintFor({
      source: input.source,
      errorName,
      route: input.route,
      message: input.error.message || '',
    });

    try {
      const { data, error } = await supabase
        .from('system_errors')
        .insert({
          source: input.source,
          severity: input.severity ?? 'error',
          client_id: input.clientId ?? null,
          request_id: input.requestId ?? null,
          route: input.route ?? null,
          method: input.method ?? null,
          status_code: input.statusCode ?? null,
          error_name: errorName,
          message,
          stack,
          context: redactContext(input.context),
          fingerprint,
        })
        .select('id')
        .single();

      if (error) {
        logger.error({ err: error }, 'Failed to record system_error');
        return null;
      }
      return (data as { id: string }).id;
    } catch (err) {
      logger.error({ err }, 'Failed to record system_error');
      return null;
    }
  }

  /** Occurrences of a fingerprint within the trailing window. */
  async countRecent(fingerprint: string, windowMs: number): Promise<number> {
    const since = new Date(Date.now() - windowMs).toISOString();
    const { count, error } = await supabase
      .from('system_errors')
      .select('id', { count: 'exact', head: true })
      .eq('fingerprint', fingerprint)
      .gte('occurred_at', since);
    if (error) {
      logger.error({ err: error, fingerprint }, 'Failed to count recent system_errors');
      return 0;
    }
    return count ?? 0;
  }

  async markReviewed(id: string, userId: string): Promise<void> {
    await supabase
      .from('system_errors')
      .update({ reviewed_at: new Date().toISOString(), reviewed_by: userId })
      .eq('id', id);
  }

  /** Attach every row sharing a fingerprint to a ticket. */
  async linkToTicket(fingerprint: string, ticketId: string): Promise<void> {
    await supabase.from('system_errors').update({ ticket_id: ticketId }).eq('fingerprint', fingerprint);
  }

  /** Nightly retention purge. Returns rows removed. */
  async purgeOlderThan(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('system_errors')
      .delete()
      .lt('occurred_at', cutoff)
      .select('id');
    if (error) {
      logger.error({ err: error }, 'system_errors retention purge failed');
      return 0;
    }
    return (data ?? []).length;
  }
}

export const systemErrorService = new SystemErrorService();
