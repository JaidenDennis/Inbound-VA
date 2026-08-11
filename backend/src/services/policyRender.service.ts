import { supabase } from '../db/index.js';

/**
 * Rebuild `client_settings.business_policies` from `client_policies`.
 *
 * That TEXT[] is the agent-facing contract: seven Retell templates and four
 * other call sites read it (via `clientService.getSettings()` /
 * `ClientSettings.business_policies` — see client.service.ts and
 * client.types.ts), so it stays authoritative and this function keeps it true
 * after every edit. The rendered form is "Title: Body", which gives the
 * prompt more structure than the anonymous strings it used to receive.
 *
 * DEVIATION FROM THE TASK BRIEF: the brief's draft wrote the rendered array to
 * `clients.business_policies`. That column does not exist on `clients` — it
 * lives on `client_settings` (confirmed against the live schema and against
 * every one of the 11 read sites, all of which resolve through
 * `client_settings`). Writing to `clients` as drafted would fail with
 * "column business_policies does not exist" on first call. This writes to
 * `client_settings` instead, keyed by `client_id` (the FK column on that
 * table, not `id`).
 *
 * Returns what it wrote, so callers can assert on it and tests can pin the
 * exact string the agent will be given.
 */
export async function renderPolicies(clientId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('client_policies')
    .select('title, body, sort_order')
    .eq('client_id', clientId)
    .eq('active', true)
    .order('sort_order');
  if (error) throw new Error(error.message);

  const rendered = (data ?? []).map((p: { title: string; body: string | null }) => {
    const title = p.title.trim();
    const body = (p.body ?? '').trim();
    // A titled policy with no body is a heading the agent can still state;
    // emitting "Title: " with nothing after it just reads as broken.
    return body ? `${title}: ${body}` : title;
  });

  const { error: writeError } = await supabase
    .from('client_settings')
    .update({ business_policies: rendered })
    .eq('client_id', clientId);
  if (writeError) throw new Error(writeError.message);

  return rendered;
}
