import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../db/index.js';
import { callProcessingQueue, transcriptProcessingQueue } from '../queues/index.js';
import { buildIdempotencyKey } from '../utils/index.js';
import { logger } from '../utils/index.js';
import type { Call, Conversation, CallTranscript, CallSummary } from '../types/index.js';

export class CallService {
  async createCall(data: Partial<Call>): Promise<Call> {
    const { data: call, error } = await supabase
      .from('calls')
      .insert({ id: uuidv4(), ...data })
      .select()
      .single();
    if (error) throw new Error(error.message);
    logger.info({ callId: call.id, retellCallId: call.retell_call_id }, 'Call created');
    return call as Call;
  }

  async findByRetellId(retellCallId: string): Promise<Call | null> {
    const { data } = await supabase
      .from('calls')
      .select('*')
      .eq('retell_call_id', retellCallId)
      .maybeSingle();
    return data as Call | null;
  }

  async endCall(callId: string, data: Partial<Call>): Promise<Call> {
    const { data: call, error } = await supabase
      .from('calls')
      .update({ ...data, status: 'completed' })
      .eq('id', callId)
      .select()
      .single();
    if (error) throw new Error(error.message);

    await callProcessingQueue.add(
      'process-call',
      {
        clientId: call.client_id,
        callId: call.id,
        retellCallId: call.retell_call_id,
        idempotencyKey: buildIdempotencyKey('call-processing', call.id),
      },
      { jobId: buildIdempotencyKey('call-processing', call.id) }
    );

    return call as Call;
  }

  async processTranscript(callId: string, clientId: string, transcript: Array<{ role: string; content: string; timestamp_ms: number }>): Promise<void> {
    await transcriptProcessingQueue.add(
      'process-transcript',
      { clientId, callId, transcript, idempotencyKey: buildIdempotencyKey('transcript', callId) },
      { jobId: buildIdempotencyKey('transcript', callId) }
    );
  }

  async upsertConversation(data: Partial<Conversation>): Promise<Conversation> {
    const { data: conv, error } = await supabase
      .from('conversations')
      .upsert({ id: uuidv4(), ...data }, { onConflict: 'call_id' })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return conv as Conversation;
  }

  async upsertSummary(data: Partial<CallSummary>): Promise<CallSummary> {
    const { data: summary, error } = await supabase
      .from('call_summaries')
      .upsert({ id: uuidv4(), ...data }, { onConflict: 'call_id' })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return summary as CallSummary;
  }

  /**
   * List calls, newest first.
   *
   * `clientId: null` is the platform-wide view — staff looking at every tenant
   * at once. Client-scoped callers are pinned to their own id upstream, so a
   * null here can only come from a platform user.
   *
   * The client name is joined in rather than fetched per row, so the calls list
   * can say *whose* call it was without N+1 lookups.
   */
  async list(
    clientId: string | null,
    page = 1,
    limit = 20,
    q?: string
  ): Promise<{ data: Call[]; count: number }> {
    const from = (page - 1) * limit;
    let query = supabase
      .from('calls')
      .select('*, clients(id, name)', { count: 'exact' })
      .order('started_at', { ascending: false });

    if (clientId) query = query.eq('client_id', clientId);

    // Search server-side: the client list can run to thousands of rows, and
    // filtering in the browser only ever searches the page already loaded.
    if (q?.trim()) {
      const term = `%${q.trim()}%`;
      query = query.or(`from_number.ilike.${term},to_number.ilike.${term},status.ilike.${term}`);
    }

    const { data, count } = await query.range(from, from + limit - 1);
    return { data: (data ?? []) as Call[], count: count ?? 0 };
  }

  async getTranscript(callId: string): Promise<CallTranscript | null> {
    const { data } = await supabase.from('call_transcripts').select('*').eq('call_id', callId).maybeSingle();
    return data as CallTranscript | null;
  }

  async getSummary(callId: string): Promise<CallSummary | null> {
    const { data } = await supabase.from('call_summaries').select('*').eq('call_id', callId).maybeSingle();
    return data as CallSummary | null;
  }
}

export const callService = new CallService();
