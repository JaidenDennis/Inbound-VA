/**
 * Backfill call_transcripts / call_summaries / conversations from Retell.
 *
 * WHY THIS EXISTS
 *
 * Migration 028 documents the bug: all three tables had a plain (not unique)
 * index on call_id while three call sites upserted with ON CONFLICT on that
 * column, so every write raised 42P10 and was swallowed. The platform threw
 * away every transcript it ever received. 028 fixed the constraint for calls
 * taken *since*; this recovers the ones taken before, which Retell still holds.
 *
 * Idempotent — all three tables now have a UNIQUE index on call_id, so re-runs
 * update in place rather than duplicating.
 *
 *   npx tsx scripts/backfill-transcripts.ts <client-slug>
 *   npx tsx scripts/backfill-transcripts.ts <client-slug> --dry
 *
 * Nothing here is invented: transcript turns, summary text, and sentiment all
 * come from the Retell API. key_topics are extracted by matching the client's
 * own configured service names against the transcript — deterministic, not
 * generated. action_items are left empty because Retell does not supply them
 * and guessing would put fabricated to-dos in front of an operator.
 */
import 'dotenv/config';
import Retell from 'retell-sdk';
import { createClient } from '@supabase/supabase-js';

const slug = process.argv[2];
const dryRun = process.argv.includes('--dry');

if (!slug) {
  console.error('Usage: npx tsx scripts/backfill-transcripts.ts <client-slug> [--dry]');
  process.exit(1);
}

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const retell = new Retell({ apiKey: process.env.RETELL_API_KEY! });

interface TranscriptTurn {
  role: string;
  content: string;
}

/** Retell returns capitalised sentiment; the column CHECKs lowercase. */
function normaliseSentiment(raw: unknown): 'positive' | 'neutral' | 'negative' {
  const value = String(raw ?? '').toLowerCase();
  return value === 'positive' || value === 'negative' ? value : 'neutral';
}

/**
 * Match the client's configured service names against the transcript.
 * Extraction, not generation — a topic only appears if the words were said.
 */
function extractKeyTopics(transcript: string, serviceNames: string[]): string[] {
  const haystack = transcript.toLowerCase();
  return serviceNames.filter((name) => haystack.includes(name.toLowerCase()));
}

/** Cheap deterministic intent flags, from phrases actually present. */
function detectFlags(transcript: string): {
  booking_requested: boolean;
  handoff_requested: boolean;
} {
  const t = transcript.toLowerCase();
  return {
    booking_requested: /\b(book|appointment|schedule|consultation|reschedul)/.test(t),
    handoff_requested: /\b(speak (to|with) (a|someone)|transfer|human|team member|call ?back)/.test(t),
  };
}

/**
 * Recreate `calls` rows for call_records that have no matching one.
 *
 * call_records and calls are parallel tables keyed on retell_call_id, written
 * by different webhook handlers. Where call_analyzed landed but the
 * started/ended handler did not, the analysis row exists with no call beside
 * it — and because the client_call_log view is driven FROM call_records, those
 * calls show on the reporting page with no caller number and no transcript.
 *
 * Everything written here comes from the Retell API. The contact is resolved by
 * phone number the same way the live path does, so recovered calls thread into
 * the existing contact list rather than creating duplicates.
 */
async function recoverOrphans(clientId: string): Promise<number> {
  const { data: records } = await sb
    .from('call_records')
    .select('retell_call_id')
    .eq('client_id', clientId);
  const { data: existing } = await sb
    .from('calls')
    .select('retell_call_id')
    .eq('client_id', clientId);

  const have = new Set((existing ?? []).map((c) => c.retell_call_id));
  const orphans = (records ?? []).filter((r) => !have.has(r.retell_call_id));
  if (!orphans.length) {
    console.log('No orphaned call_records to recover.');
    return 0;
  }

  console.log(`\nRecovering ${orphans.length} call_records with no calls row:`);
  let recovered = 0;

  for (const orphan of orphans) {
    let remote;
    try {
      remote = await retell.call.retrieve(orphan.retell_call_id);
    } catch {
      console.log(`  ${orphan.retell_call_id.slice(0, 22)}  UNAVAILABLE at Retell`);
      continue;
    }

    const from = remote.from_number ?? '';
    const to = remote.to_number ?? '';
    if (!from || !to) {
      console.log(`  ${orphan.retell_call_id.slice(0, 22)}  no phone numbers held, skipping`);
      continue;
    }

    // Resolve the contact by phone, creating one only if genuinely new.
    let contactId: string | null = null;
    const { data: contact } = await sb
      .from('contacts')
      .select('id')
      .eq('client_id', clientId)
      .eq('phone', from)
      .maybeSingle();
    if (contact) {
      contactId = contact.id;
    } else {
      const { data: made } = await sb
        .from('contacts')
        .insert({ client_id: clientId, phone: from, tags: ['recovered'] })
        .select('id')
        .single();
      contactId = made?.id ?? null;
    }

    const startedAt = remote.start_timestamp ? new Date(remote.start_timestamp) : new Date();
    const endedAt = remote.end_timestamp ? new Date(remote.end_timestamp) : null;

    if (dryRun) {
      console.log(`  ${String(startedAt.toISOString()).slice(0, 16)}  ${from} -> would recover`);
      recovered += 1;
      continue;
    }

    const { error } = await sb.from('calls').insert({
      client_id: clientId,
      contact_id: contactId,
      retell_call_id: orphan.retell_call_id,
      direction: remote.direction === 'outbound' ? 'outbound' : 'inbound',
      from_number: from,
      to_number: to,
      status: 'completed',
      duration_seconds: remote.duration_ms ? Math.round(remote.duration_ms / 1000) : null,
      recording_url: remote.recording_url ?? null,
      started_at: startedAt.toISOString(),
      ended_at: endedAt ? endedAt.toISOString() : null,
    });
    if (error) {
      console.log(`  ${orphan.retell_call_id.slice(0, 22)}  insert failed: ${error.message}`);
      continue;
    }
    console.log(`  ${String(startedAt.toISOString()).slice(0, 16)}  ${from}  recovered`);
    recovered += 1;
  }

  return recovered;
}

async function main(): Promise<void> {
  const { data: client, error: clientErr } = await sb
    .from('clients')
    .select('id, name')
    .eq('slug', slug)
    .single();
  if (clientErr || !client) throw new Error(`No client with slug '${slug}'`);

  // Recover missing calls rows FIRST so the transcript pass below picks them up.
  if (process.argv.includes('--recover-orphans')) {
    const n = await recoverOrphans(client.id);
    console.log(`Recovered ${n} calls.\n`);
  }

  const { data: settings } = await sb
    .from('client_settings')
    .select('services')
    .eq('client_id', client.id)
    .maybeSingle();

  const serviceNames = Array.isArray(settings?.services)
    ? (settings.services as Array<{ name?: string }>).map((s) => s.name).filter(Boolean as unknown as (v: unknown) => v is string)
    : [];

  const { data: calls, error: callsErr } = await sb
    .from('calls')
    .select('id, retell_call_id, started_at')
    .eq('client_id', client.id)
    .not('retell_call_id', 'is', null)
    .order('started_at', { ascending: false });
  if (callsErr) throw callsErr;

  console.log(`${client.name}: ${calls.length} calls with a Retell id`);
  if (serviceNames.length) console.log(`  matching key topics against: ${serviceNames.join(', ')}`);
  if (dryRun) console.log('DRY RUN — nothing will be written\n');

  let written = 0;
  let missing = 0;

  for (const call of calls) {
    let remote;
    try {
      remote = await retell.call.retrieve(call.retell_call_id!);
    } catch (err) {
      console.log(`  ${String(call.started_at).slice(0, 16)}  UNAVAILABLE at Retell (${(err as Error).message})`);
      missing += 1;
      continue;
    }

    const flat = (remote.transcript ?? '').trim();
    if (!flat) {
      console.log(`  ${String(call.started_at).slice(0, 16)}  no transcript held`);
      missing += 1;
      continue;
    }

    const turns: TranscriptTurn[] = Array.isArray(remote.transcript_object)
      ? (remote.transcript_object as Array<{ role?: string; content?: string }>).map((t) => ({
          // The dashboard styles the agent side on `role === 'agent'`.
          role: t.role === 'agent' ? 'agent' : 'user',
          content: t.content ?? '',
        }))
      : [];

    const analysis = (remote.call_analysis ?? {}) as {
      call_summary?: string;
      user_sentiment?: string;
      call_successful?: boolean;
    };
    const wordCount = flat.split(/\s+/).filter(Boolean).length;
    const sentiment = normaliseSentiment(analysis.user_sentiment);
    const flags = detectFlags(flat);

    console.log(
      `  ${String(call.started_at).slice(0, 16)}  ${turns.length} turns, ${wordCount} words, ${sentiment}` +
        (analysis.call_successful === false ? ', unsuccessful' : '')
    );
    written += 1;
    if (dryRun) continue;

    const { error: tErr } = await sb.from('call_transcripts').upsert(
      { call_id: call.id, client_id: client.id, transcript: turns, word_count: wordCount },
      { onConflict: 'call_id' }
    );
    if (tErr) throw new Error(`transcript ${call.id}: ${tErr.message}`);

    if (analysis.call_summary) {
      const { error: sErr } = await sb.from('call_summaries').upsert(
        {
          call_id: call.id,
          client_id: client.id,
          summary: analysis.call_summary,
          action_items: [],
          key_topics: extractKeyTopics(flat, serviceNames),
          sentiment,
          // An unsuccessful call is precisely the one a human should look at.
          follow_up_required: analysis.call_successful === false,
        },
        { onConflict: 'call_id' }
      );
      if (sErr) throw new Error(`summary ${call.id}: ${sErr.message}`);
    }

    const { error: cErr } = await sb.from('conversations').upsert(
      {
        call_id: call.id,
        client_id: client.id,
        sentiment,
        summary: analysis.call_summary ?? null,
        lead_captured: false,
        ...flags,
        metadata: { source: 'retell-backfill', call_successful: analysis.call_successful ?? null },
      },
      { onConflict: 'call_id' }
    );
    if (cErr) throw new Error(`conversation ${call.id}: ${cErr.message}`);
  }

  console.log(`\n${dryRun ? 'Would write' : 'Wrote'} ${written} calls; ${missing} unavailable.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
