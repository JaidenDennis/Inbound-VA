import { supabase } from '../db/index.js';
import { logger } from '../utils/index.js';
import { systemErrorService } from './systemError.service.js';
import type { Ticket } from '../types/index.js';

/**
 * Bridges the error console to the support queue: a fault that keeps happening
 * becomes something a person owns, instead of a row nobody is responsible for.
 *
 * Platform-wide constants rather than per-client configuration — the thresholds
 * describe our operational tolerance, not a client's, so no client-specific
 * logic enters the codebase.
 */
export const ALERT_OCCURRENCE_THRESHOLD = 5;
export const ALERT_WINDOW_MS = 15 * 60 * 1000;

/** Statuses that mean a ticket is still someone's problem. */
const OPEN_STATUSES = ['investigating', 'waiting_on_client', 'waiting_on_third_party'];

export class SystemAlertService {
  /**
   * Called after a fault is recorded. Opens at most one ticket per fingerprint:
   * the 200th recurrence of an outage attaches to the ticket the 5th opened.
   * Returns the ticket when one was opened or matched, else null.
   */
  async maybeOpenTicket(input: {
    fingerprint: string;
    clientId: string | null;
    title: string;
    detail: string;
    /** Skip the rate threshold — used when a job has already exhausted retries. */
    immediate?: boolean;
  }): Promise<Ticket | null> {
    // A ticket needs a tenant. Platform-wide faults have none, so they stay in
    // the console where staff already look, rather than being forced onto some
    // arbitrary client's support thread.
    if (!input.clientId) return null;

    try {
      const existing = await this.findOpenTicketFor(input.fingerprint);
      if (existing) {
        await systemErrorService.linkToTicket(input.fingerprint, existing.id);
        return existing;
      }

      if (!input.immediate) {
        const occurrences = await systemErrorService.countRecent(input.fingerprint, ALERT_WINDOW_MS);
        if (occurrences < ALERT_OCCURRENCE_THRESHOLD) return null;
      }

      const ticket = await this.openTicket(input);
      if (ticket) await systemErrorService.linkToTicket(input.fingerprint, ticket.id);
      return ticket;
    } catch (err) {
      // Never let alerting failure propagate into the error path that called it.
      logger.error({ err, fingerprint: input.fingerprint }, 'Auto-ticket bridge failed');
      return null;
    }
  }

  private async findOpenTicketFor(fingerprint: string): Promise<Ticket | null> {
    const { data } = await supabase
      .from('tickets')
      .select('*')
      .eq('error_fingerprint', fingerprint)
      .in('status', OPEN_STATUSES)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as Ticket) ?? null;
  }

  private async openTicket(input: {
    fingerprint: string;
    clientId: string | null;
    title: string;
    detail: string;
  }): Promise<Ticket | null> {
    const occurrences = await systemErrorService.countRecent(input.fingerprint, ALERT_WINDOW_MS);
    const { data, error } = await supabase
      .from('tickets')
      .insert({
        client_id: input.clientId,
        // No dashboard user raised this. `source` distinguishes it from a human
        // report so the queue can filter and the SLA clock still applies.
        created_by: null,
        source: 'system',
        error_fingerprint: input.fingerprint,
        subject: `System fault: ${input.title}`.slice(0, 200),
        description:
          `Detected automatically by the system health monitor.\n\n` +
          `${input.detail}\n\n` +
          `Occurrences in the last ${Math.round(ALERT_WINDOW_MS / 60000)} minutes: ${occurrences}\n` +
          `Fingerprint: ${input.fingerprint}`,
        priority: 'high',
        status: 'investigating',
      })
      .select()
      .single();

    if (error) {
      logger.error({ err: error, fingerprint: input.fingerprint }, 'Failed to open auto-ticket');
      return null;
    }

    const ticket = data as Ticket;
    await supabase.from('ticket_status_history').insert({
      ticket_id: ticket.id,
      from_status: null,
      to_status: 'investigating',
      changed_by: null,
      note: 'Opened automatically from repeated system errors',
    });

    logger.warn({ ticketId: ticket.id, fingerprint: input.fingerprint }, 'Auto-ticket opened for recurring fault');
    return ticket;
  }

  /**
   * Close auto-tickets whose fault has gone quiet and that no person has picked
   * up. A ticket with a human message stays open for a human to close — silence
   * from the system is not the same as the problem being understood.
   */
  async autoCloseQuietTickets(quietHours = 24): Promise<number> {
    const cutoff = new Date(Date.now() - quietHours * 60 * 60 * 1000).toISOString();

    const { data: candidates } = await supabase
      .from('tickets')
      .select('id, error_fingerprint, created_at')
      .eq('source', 'system')
      .in('status', OPEN_STATUSES)
      .lt('created_at', cutoff);

    let closed = 0;
    for (const ticket of (candidates ?? []) as Array<{ id: string; error_fingerprint: string }>) {
      const { count: messageCount } = await supabase
        .from('ticket_messages')
        .select('id', { count: 'exact', head: true })
        .eq('ticket_id', ticket.id);
      if ((messageCount ?? 0) > 0) continue; // a person engaged — leave it

      const { count: recentErrors } = await supabase
        .from('system_errors')
        .select('id', { count: 'exact', head: true })
        .eq('fingerprint', ticket.error_fingerprint)
        .gte('occurred_at', cutoff);
      if ((recentErrors ?? 0) > 0) continue; // still firing

      await supabase.from('tickets').update({ status: 'resolved', auto_closed_at: new Date().toISOString() }).eq('id', ticket.id);
      await supabase.from('ticket_status_history').insert({
        ticket_id: ticket.id,
        from_status: 'investigating',
        to_status: 'resolved',
        changed_by: null,
        note: `Auto-resolved: no recurrence in ${quietHours}h and no human activity`,
      });
      closed += 1;
    }

    if (closed > 0) logger.info({ closed }, 'Auto-closed quiet system tickets');
    return closed;
  }
}

export const systemAlertService = new SystemAlertService();
