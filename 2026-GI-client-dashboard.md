# Gravvia Client Dashboard — Design Spec

Date: 2026-06-22
Status: Approved design, pending spec review

## Purpose

A client-facing area inside the existing Gravvia app that an onboarded client
can use to:

1. Submit and track support tickets.
2. See live progress through their onboarding/deployment pipeline.
3. See a list of items the client still owes us ("Waiting on You").
4. Once live, see near-real-time call performance statistics for their voice agent.

The owner (and support staff) get an admin surface to triage tickets, advance
onboarding stages, and manage client action items.

## Non-goals (YAGNI for v1)

- Email notifications (Telegram only in v1; Discord is a drop-in swap).
- SLA timers / escalation rules.
- Auto-assignment of tickets (owner clicks "assign to me").
- Mid-call / real-time streaming stats (stats update after each call completes).
- Multi-language, billing, or self-serve signup (out of scope here).

## Where it lives

Inside the existing Gravvia Next.js app, as a new client-facing area, reusing
the existing Supabase auth and multi-tenancy. No new app, no duplicated auth.

- Client surface: stripped-down view scoped to the signed-in client's tenant.
- Admin surface: existing/owner area, extended with ticket triage, stage
  control, and action-item management across all clients.

## Architecture overview

```
Client dashboard  --submit ticket-->  Fastify backend  --insert-->  Supabase (RLS)
                                            |
                                            +--send-->  Telegram alert --> owner phone

Retell AI  --call_analyzed webhook-->  Fastify backend  --insert call_record-->  Supabase
                                                                                    |
Client dashboard  <--aggregate stats / read tickets & milestones (RLS)-------------+
```

- Ticket creation goes through a Fastify endpoint that (1) inserts the ticket and
  (2) fires the Telegram notification in the same request.
- Retell's `call_analyzed` webhook hits a Fastify endpoint that writes one
  `call_record` row per completed call, mapped to a client via `agent_id`.
- The client dashboard reads tickets, milestones, action items, and aggregated
  call stats directly from Supabase, protected by RLS.

## Data model (Supabase / Postgres)

All tables are tenant-scoped by `client_id` and protected with RLS so a client
can only read/write their own rows. `client_id` references the existing
clients/organizations table.

### tickets
- `id` (uuid, pk)
- `client_id` (uuid, fk -> clients)
- `created_by` (uuid, fk -> auth.users)
- `subject` (text)
- `description` (text)
- `priority` (enum: low | normal | high | urgent)
- `status` (enum: investigating | waiting_on_client | waiting_on_third_party | resolved | closed) — default `investigating` on creation
- `assigned_to` (uuid, fk -> auth.users, nullable)
- `created_at`, `updated_at` (timestamptz)

Status flow: a new ticket starts as `investigating`. Owner moves it through
`waiting_on_client` / `waiting_on_third_party` as needed, then `resolved`, then
`closed`. (If a distinct "New / unread" state is wanted later, add it as a sixth
value — for v1 a freshly submitted ticket reads as `investigating`.)

### ticket_status_history
Append-only audit trail; one row per status change. Powers the History tab.
- `id` (uuid, pk)
- `ticket_id` (uuid, fk -> tickets)
- `from_status` (text, nullable) — null for the initial creation row
- `to_status` (text)
- `changed_by` (uuid, fk -> auth.users)
- `note` (text, nullable) — optional context for the change
- `created_at` (timestamptz)

Write a row on ticket creation (`from_status = null`, `to_status = investigating`)
and on every subsequent status change. The ticket's current status is always the
latest `to_status`.

### ticket_messages
- `id` (uuid, pk)
- `ticket_id` (uuid, fk -> tickets)
- `author_id` (uuid, fk -> auth.users)
- `body` (text)
- `created_at` (timestamptz)

Threaded back-and-forth between client and support inside a ticket.

### onboarding_milestones
One row per stage per client. Stages (fixed order):
1. Account Setup
2. Business Discovery
3. System Configuration
4. CRM Integrations
5. Demo Review
6. Testing & QA
7. Go Live
8. Post Launch Optimization

- `id` (uuid, pk)
- `client_id` (uuid, fk -> clients)
- `stage_key` (enum / text: account_setup | business_discovery | system_configuration | crm_integrations | demo_review | testing_qa | go_live | post_launch_optimization)
- `status` (enum: not_started | in_progress | complete)
- `completed_at` (timestamptz, nullable)
- `sort_order` (int) — to render the timeline in fixed order

On client creation, seed all 8 milestone rows as `not_started`. Owner advances
them from the admin view.

### client_action_items  ("Waiting on You")
- `id` (uuid, pk)
- `client_id` (uuid, fk -> clients)
- `title` (text)
- `description` (text, nullable)
- `status` (enum: pending | done)
- `created_by` (uuid, fk -> auth.users)  — the owner/staff who added it
- `created_at`, `updated_at` (timestamptz)

Owner adds items; client marks them done.

### call_records
One row per completed Retell call, written by the `call_analyzed` webhook.
- `id` (uuid, pk)
- `client_id` (uuid, fk -> clients) — resolved from Retell `agent_id`
- `retell_call_id` (text, unique) — idempotency key
- `agent_id` (text)
- `started_at`, `ended_at` (timestamptz)
- `duration_seconds` (int) — from Retell `total_duration_seconds`
- `in_voicemail` (bool)
- `disconnection_reason` (text)
- `user_sentiment` (text, nullable)
- `call_successful` (bool, nullable)
- `appointment_booked` (bool, default false) — from custom_analysis_data
- `lead_recaptured` (bool, default false) — from custom_analysis_data
- `missed_call_recovered` (bool, default false) — from custom_analysis_data
- `raw_analysis` (jsonb) — full custom_analysis_data for future-proofing
- `created_at` (timestamptz)

Need a mapping from Retell `agent_id` -> `client_id`. Store `retell_agent_id`
on the existing clients table (one-agent-per-client), and look it up on webhook.

## Stats panel

Visible only when the client's `go_live` milestone is `complete`.

Aggregations over `call_records` for the selected date range:
- Calls Answered = count where `in_voicemail = false`
- Missed Calls Recovered = count where `missed_call_recovered = true`
- Leads Recaptured = count where `lead_recaptured = true`
- Appointments Booked = count where `appointment_booked = true`
- Average Call Duration = avg(`duration_seconds`) where `in_voicemail = false`

Date-range filter (e.g. last 7 / 30 days / custom). Updates near-real-time as
new `call_records` arrive after each call's analysis completes.

The three custom metrics depend on post-call analysis fields being defined on
the Retell agent (`appointment_booked`, `lead_recaptured`, `missed_call_recovered`).
If a field isn't defined for a given agent, that metric reads 0 rather than
breaking — the panel degrades gracefully.

## Components

### Backend (Fastify, @gravvia/backend)
- `POST /api/tickets` — create ticket, insert, then send notification. Returns ticket.
- `POST /api/tickets/:id/messages` — append a reply.
- `PATCH /api/tickets/:id` — admin: assign / change status.
- `POST /api/webhooks/retell` — receive `call_analyzed`, upsert `call_record`
  (idempotent on `retell_call_id`), map `agent_id` -> `client_id`.
- `notify(channel, payload)` module — pluggable. v1 implements Telegram
  (`sendMessage` via Bot API using token + chat id from env). Discord = swap to
  a webhook POST. Channel selected by env config.

### Frontend (Next.js, @gravvia/dashboard)
Client surface:
- Onboarding timeline (8 stages, current stage highlighted).
- "Waiting on You" list (client can mark items done).
- "Submit a ticket" form + list of own tickets. Each ticket opens a detail view
  with two tabs: Conversation (the message thread) and History (the
  status-change audit trail from `ticket_status_history`). Current status shown
  as a badge at the top.
- Stats panel (only after Go Live).

Admin surface:
- Ticket queue across clients: assign-to-me, status controls, reply.
- Per-client stage control (advance onboarding milestones).
- Per-client action-item management (add/edit "Waiting on You" items).

## Notifications

- One-time setup: create a bot via @BotFather, store bot token + owner chat id
  in backend env (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`).
- On ticket creation, send: client name, subject, priority, and a deep link to
  the ticket in the admin view.
- Discord alternative: set `NOTIFY_CHANNEL=discord` and provide
  `DISCORD_WEBHOOK_URL`; `notify()` POSTs to it instead. No code changes beyond
  the module's send function.

## Error handling

- Ticket insert and notification are sequential; if notification fails, the
  ticket is still saved and the failure is logged (don't fail the client's
  submission because Telegram is down). Optionally retry/queue later.
- Retell webhook is idempotent on `retell_call_id` (safe to receive duplicates).
- Unknown `agent_id` on a webhook -> log and skip (don't write an orphan record).
- RLS is the security boundary; backend uses the service role only for the
  webhook write, never to bypass tenant scoping on client-facing reads.

## Testing

- Unit: `notify()` (Telegram + Discord shapes), agent->client mapping, stats
  aggregation queries, milestone seeding.
- Integration: ticket create -> row written + notification attempted;
  Retell webhook -> idempotent call_record upsert; RLS isolation (client A
  cannot read client B's tickets/stats).
- Manual: end-to-end ticket submission triggers a real Telegram message;
  a Go Live client shows a populated stats panel.

## Open items to confirm before implementation

- Confirm the existing clients/organizations table name and primary key, and
  whether `retell_agent_id` already lives there or needs to be added.
- Confirm exact custom_analysis_data field names configured on the Retell agent
  (so `appointment_booked` etc. map 1:1).