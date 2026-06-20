# Per-Client Retell Voice Agent — Integration Guide

This system provisions **one Retell agent per client** from each client's
`client_settings`, using a reusable, vertical-specific template (med spa first).

## Environment variables (set in Render / `.env`)

| Var | Purpose |
|---|---|
| `RETELL_API_KEY` | Retell API key. **Also used to verify webhook + custom-function signatures.** |
| `WEBHOOK_BASE_URL` | Public base URL Retell calls back into. Falls back to `API_BASE_URL`. e.g. `https://api.gravvia.com` |
| `RETELL_DEFAULT_VOICE_ID` | Default voice when a client hasn't chosen one (e.g. `11labs-Adrian`). |
| `RETELL_WEBHOOK_SECRET` | **Optional / legacy.** Retell does NOT use a separate webhook secret. |

## Signature verification (important)

Retell signs **both** webhook events **and** custom-function calls with your
**API key** via the `X-Retell-Signature` header:

```
X-Retell-Signature: v={unix_ms_timestamp},d={hmac_sha256(rawBody + timestamp, RETELL_API_KEY)}
```

valid for 5 minutes. There is **no separate webhook secret to configure in the
Retell dashboard** — just make sure `RETELL_API_KEY` is set. Verification lives in
`src/providers/retell/retell.validator.ts` and runs via the existing
`validateRetellWebhook` middleware on every webhook + function endpoint.

## Provisioning a client

```
POST /clients/:id/provision        (auth: settings:write, tenant-scoped)
body (all optional): {
  "template":   "med_spa",          // defaults to one derived from client.industry
  "phoneNumbers": ["+15551112222"], // defaults to clients.phone_numbers
  "buyAreaCode": 415                 // optional: buy a new Retell number
}
```

It is **idempotent**: it creates the Retell LLM (Response Engine) + Agent the
first time and **updates them in place** on re-runs (using the stored
`clients.retell_llm_id` / `clients.retell_agent_id`). Results are saved to
`clients` (`retell_agent_id`, `retell_llm_id`, `retell_voice_id`,
`retell_agent_version`, `retell_last_provisioned_at`).

## Webhook & function URLs (set automatically during provisioning)

The agent's single `webhook_url` is set to the **dispatcher** (Retell sends all
call events to one URL, by `event`):

```
POST {WEBHOOK_BASE_URL}/webhooks/retell        # call_started, call_ended, call_analyzed
```

The 4 granular routes (`/webhooks/retell/call-started`, `…/call-ended`,
`…/transcript`, `…/summary`) remain available and unchanged.

Custom functions the agent calls mid-call (all signature-validated):

```
POST {WEBHOOK_BASE_URL}/functions/retell/check_availability
POST {WEBHOOK_BASE_URL}/functions/retell/book_appointment
POST {WEBHOOK_BASE_URL}/functions/retell/book_consultation
POST {WEBHOOK_BASE_URL}/functions/retell/qualify_lead
POST {WEBHOOK_BASE_URL}/functions/retell/lookup_existing_client
POST {WEBHOOK_BASE_URL}/functions/retell/schedule_callback
POST {WEBHOOK_BASE_URL}/functions/retell/leave_staff_message
POST {WEBHOOK_BASE_URL}/functions/retell/request_human_handoff
```

> ⚠️ **Stale function URLs (the ngrok 404):** the agent's function URLs are
> baked in at provisioning time from `WEBHOOK_BASE_URL`. If you provisioned while
> `WEBHOOK_BASE_URL` pointed at a dev tunnel (e.g. ngrok) and that tunnel died,
> the agent calls a dead URL → 404. Fix: set `WEBHOOK_BASE_URL` to the **deployed
> backend URL** and **re-provision** (`POST /clients/:id/provision`) to refresh
> every webhook + function URL. Likewise, `schedule_callback` 404s if the agent
> references it but the endpoint isn't deployed — it now exists and re-provisioning
> wires it.

## Agent identity (no spoken `{{variables}}`)

`business_name` and `agent_name` live on `client_settings` (migration 006) and are
**rendered into the prompt at provisioning** — the agent never speaks a raw
`{{variable}}`. If a value is missing it falls back gracefully (business → client
name; agent → "your assistant"). `agent_config` (jsonb) holds vertical offerings
(`membership_program`, `offers_packages`, `offers_prp`, `free_consultation`) that
gate which upsells the med-spa template may mention — keeping the rules in the
template and the data per-client.

## Phone numbers

Provisioning maps each number in `clients.phone_numbers` to the agent
(`inbound_agents`). Pass `buyAreaCode` to purchase a new number via Retell and
bind it (this spends money). Numbers are also recorded in `retell_phone_numbers`.

## Post-call automation

Triggered off the event bus after `call_analyzed` / booking:
- **CRM outcome note** + existing contact/summary/transcript/appointment sync.
- **Lead recovery** — qualified-but-didn't-book → delayed staff follow-up.
- **Missed-call follow-up** — unresolved call → delayed callback nudge.
- **Appointment confirmation + reminder** — on booking, immediate confirmation +
  a reminder scheduled 24h before the appointment (reduces no-shows).

## Adding another vertical

Implement `AgentTemplate` and register it in
`src/providers/retell/templates/index.ts`; no other code changes needed.

## DB migration

Run `supabase/migrations/005_retell_provisioning.sql` (adds the `retell_*`
columns + `retell_phone_numbers`). Never edits earlier migrations.
