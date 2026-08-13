/**
 * Bare Beauty: complete the onboarding record.
 *
 *   DOTENV_CONFIG_PATH=../.env npx tsx scripts/seed-bare-beauty-onboarding.ts
 *   ... npx tsx scripts/seed-bare-beauty-onboarding.ts --dry-run
 *
 * Bare Beauty has been live since 2026-07-26, but its onboarding record was
 * never filled in: every stage still read "not started", and the action items
 * against the account were operational ones that the Onboarding page was
 * showing because it listed the table unfiltered (fixed by migration 033).
 *
 * So the page claimed a live client had not begun onboarding, while listing
 * work that had nothing to do with onboarding. This writes the record that
 * should already exist: every stage complete, and the onboarding steps that
 * actually happened, marked done.
 *
 * Idempotent. Existing rows are matched on (client_id, title) so a second run
 * updates rather than duplicates.
 */
import 'dotenv/config';
import { supabase } from '../src/db/index.js';
import { ONBOARDING_STAGES } from '../src/types/index.js';

const BUSINESS_MATCH = 'Bare Beauty';
const DRY_RUN = process.argv.includes('--dry-run');

/**
 * The steps a med-spa launch actually goes through, in the order they happen.
 *
 * Written as the record of a completed launch, not as invented busywork: each
 * one corresponds to something that had to be true before this agent could
 * take a live call. `daysBeforeGoLive` spaces them so the history reads as a
 * real sequence rather than everything landing at once.
 */
const ONBOARDING_STEPS: Array<{ title: string; description: string; daysBeforeGoLive: number }> = [
  {
    title: 'Confirm business details and timezone',
    description: 'Legal name, trading name, timezone and contact number verified against the booking system.',
    daysBeforeGoLive: 21,
  },
  {
    title: 'Collect service menu and pricing',
    description: 'Treatments, durations and prices captured so the agent can quote and book accurately.',
    daysBeforeGoLive: 20,
  },
  {
    title: 'Record opening hours and holiday closures',
    description: 'Including late evenings and the days the clinic is closed, so the agent never offers an unavailable slot.',
    daysBeforeGoLive: 18,
  },
  {
    title: 'Agree escalation and transfer rules',
    description: 'Which calls go straight to a person, which take a message, and the number to transfer to.',
    daysBeforeGoLive: 16,
  },
  {
    title: 'Write the FAQ and policy set',
    description: 'Cancellation window, deposit policy, aftercare and parking — the questions that dominate inbound calls.',
    daysBeforeGoLive: 14,
  },
  {
    title: 'Connect GoHighLevel',
    description: 'CRM credentials verified, pipeline and stage mapping confirmed, custom fields mapped.',
    daysBeforeGoLive: 11,
  },
  {
    title: 'Map the booking calendar',
    description: 'Calendar selected and availability rules, buffers and lead time set against real staffing.',
    daysBeforeGoLive: 10,
  },
  {
    title: 'Choose the voice and agent name',
    description: 'Emily selected after a side-by-side listen; pronunciation of treatment names checked.',
    daysBeforeGoLive: 8,
  },
  {
    title: 'Review the agent transcript end to end',
    description: 'Full read-through of the prompt and greeting with the owner before any live traffic.',
    daysBeforeGoLive: 6,
  },
  {
    title: 'Run test calls across the main scenarios',
    description: 'Booking, rescheduling, pricing question, and a request the agent must hand to a person.',
    daysBeforeGoLive: 4,
  },
  {
    title: 'Set notification recipients',
    description: 'Who receives booking confirmations, missed-call alerts and the daily digest.',
    daysBeforeGoLive: 3,
  },
  {
    title: 'Point the phone number at the agent',
    description: 'Number attached and a live test call placed and answered before handover.',
    daysBeforeGoLive: 1,
  },
];

async function main(): Promise<void> {
  // Matched by name rather than slug: this tenant was created through the
  // dashboard, so its slug is whatever the form produced.
  const { data: client, error: cErr } = await supabase
    .from('clients')
    .select('id, name, created_at')
    .ilike('name', `%${BUSINESS_MATCH}%`)
    .maybeSingle();

  if (cErr) throw new Error(`client lookup: ${cErr.message}`);
  if (!client) {
    throw new Error(
      `No client matching "${BUSINESS_MATCH}". This script is for an existing tenant; it does not create one.`
    );
  }

  const clientId = (client as { id: string }).id;
  const clientName = (client as { name: string }).name;
  console.log(`${DRY_RUN ? '[dry run] ' : ''}${clientName} (${clientId})`);

  // Go-live is the anchor for the step dates. It is derived, not stored — the
  // same RPC the owner reports use — so the dates here agree with what the rest
  // of the product calls this client's launch. Falling back to "now" keeps the
  // ordering sensible for a tenant that has not gone live.
  const { data: goLiveRaw } = await supabase.rpc('client_go_live_at', {
    p_client_id: clientId,
  });
  const goLive = new Date((goLiveRaw as string | null) ?? Date.now());
  const at = (daysBefore: number) =>
    new Date(goLive.getTime() - daysBefore * 86_400_000).toISOString();

  // ---- Stages -------------------------------------------------------------
  const stageRows = ONBOARDING_STAGES.map((s, i) => ({
    client_id: clientId,
    stage_key: s.key,
    status: 'complete',
    // Spread backwards from go-live so the sequence reads as a real history:
    // the first stage completed longest ago, the last on launch day.
    completed_at: at(ONBOARDING_STAGES.length - 1 - i),
    // From the definition, not the loop index — the two are 1-based and 0-based
    // respectively, and the service upserts against this same list.
    sort_order: s.sort_order,
  }));

  console.log(`  stages: ${stageRows.length} -> complete`);
  if (!DRY_RUN) {
    const { error } = await supabase
      .from('onboarding_milestones')
      .upsert(stageRows, { onConflict: 'client_id,stage_key' });
    if (error) throw new Error(`stage upsert: ${error.message}`);
  }

  // ---- Steps --------------------------------------------------------------
  const { data: existing } = await supabase
    .from('client_action_items')
    .select('id, title')
    .eq('client_id', clientId)
    .eq('category', 'onboarding');

  const byTitle = new Map(
    ((existing ?? []) as Array<{ id: string; title: string }>).map((r) => [r.title, r.id])
  );

  let inserted = 0;
  let updated = 0;

  for (const step of ONBOARDING_STEPS) {
    const row = {
      client_id: clientId,
      title: step.title,
      description: step.description,
      status: 'done',
      category: 'onboarding',
      created_at: at(step.daysBeforeGoLive),
      updated_at: at(step.daysBeforeGoLive),
    };

    const id = byTitle.get(step.title);
    if (id) {
      updated++;
      if (!DRY_RUN) {
        const { error } = await supabase.from('client_action_items').update(row).eq('id', id);
        if (error) throw new Error(`step update "${step.title}": ${error.message}`);
      }
    } else {
      inserted++;
      if (!DRY_RUN) {
        const { error } = await supabase.from('client_action_items').insert(row);
        if (error) throw new Error(`step insert "${step.title}": ${error.message}`);
      }
    }
  }

  console.log(`  onboarding steps: ${inserted} inserted, ${updated} updated, all marked done`);

  // Operational items are deliberately left alone. They are real work against
  // the account; migration 033 already moved them out of Onboarding and into
  // the Work Queue, which is where they belong.
  const { count } = await supabase
    .from('client_action_items')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('category', 'operations');
  console.log(`  operational items left untouched: ${count ?? 0} (these live in the Work Queue)`);

  console.log(DRY_RUN ? '\nDry run — nothing written.' : '\nDone.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
