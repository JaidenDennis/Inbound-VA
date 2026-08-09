# Enterprise Dashboard — Design Spec

**Date:** 2026-08-08
**Product:** Gravvia Engage (`outbound-backend`)
**Status:** Design approved, pending implementation plan

---

## 1. Purpose

An enterprise-grade dashboard surfacing voice agent performance, operational
exceptions, and agent configuration to three distinct audiences within a client
organization. Replaces reliance on the GHL display layer for larger clients.

The dashboard must answer three different questions depending on who is looking:

| Viewer | Question | Screen type |
|---|---|---|
| Owner / exec | "Is this making me money, and can I trust it?" | Analytics |
| Manager | "What do I need to do right now?" | Work queue |
| Admin / builder | "How do I change the agent safely?" | Config |

---

## 2. Permission model

Access is **not** modeled as fixed role tiers. It is modeled as three capability
axes, with preset bundles shipped as default roles.

### Capability axes

- **view** — read data: metrics, calls, transcripts, recordings
- **act** — change state on records: trigger callback, reroute lead, resolve
  flagged call, cancel/reschedule appointment
- **configure** — change agent behavior: hours, escalation rules, routing,
  knowledge base, integrations

Each axis is scoped by resource (e.g. `view:transcripts`, `act:appointments`,
`configure:agent`) and by location for multi-location clients.

### Default role bundles

| Role | view | act | configure |
|---|---|---|---|
| Owner | all | all | all, including user and role management |
| Manager | all | all | none |
| Admin | all | all | agent, KB, integrations — not user/role management |

Owner and Admin differ on exactly one grant: `configure:roles`. Only the owner
can grant or revoke another user's access.

Bundles are editable per client. A read-only compliance role is created by
issuing `view:*` with no `act` or `configure` grants — no new tier required.

### Rationale

The highest-risk surface is configuration, not data. Clients can customize
nearly every aspect of their agent, so "reads the numbers" must be separable
from "changes the agent's behavior." Primitives rather than tiers avoid
shipping a new role each time an enterprise buyer requests a variation.

### Audit requirement

Every `configure` action and every transcript view writes to the existing
`audit_logs` table: actor, timestamp, resource, before/after state. This is a
hard requirement — it backs both the "Recent changes" UI and the compliance
answer during enterprise security review.

---

## 3. Owner / exec view

Four clusters, presented in this order. Ordering is deliberate: money first,
then candid failure data, then insight. Surfacing failure voluntarily is what
makes the money figures credible.

### 3.1 Money — the counterfactual

- Booked revenue attributed to AI-handled calls (appointments × avg ticket,
  broken out per service)
- **After-hours capture** — calls handled outside staffed hours. Primary
  persuasion metric: revenue that provably did not exist before.
- Recovered missed calls (surfaces the existing `missedCallRecovery` service)
- Cost per booked appointment, displayed next to a receptionist-hour baseline
- **Cumulative ROI since go-live** — a running total, never reset to a monthly
  window. Renewal insurance: the number only goes up, and cancelling means
  giving it up.

### 3.2 Trust — where the agent failed

- Containment rate: calls handled end-to-end with no human transfer
- Escalations grouped by **reason**, not by count
- **Flagged-call queue**: frustration signals, dead air, repeated
  clarification, caller hangup mid-flow. One click to listen.
- **AI quality score on every call** — accuracy, resolution, and tone scored
  per call, with trend over time. Coverage is the point: human QA samples a
  small fraction of calls; this scores all of them.

### 3.3 Demand intelligence

Not available from any CRM report. Primary differentiator on the enterprise sale.

- Top call reasons, ranked, trending week over week
- Services requested that the client does not offer or cannot book —
  quantified lost demand
- **Knowledge gaps**: questions the knowledge base could not answer, with an
  inline "add this answer" action writing to the KB tables
- Peak call times, framed as a staffing decision
- **Source attribution.** The agent captures "how did you hear about us"
  conversationally; the dashboard rolls it up into channel attribution. Clients
  running paid ads generally have no reliable answer to this.
- **Missed-revenue quantification.** Requests for services the client does not
  offer or cannot book, converted to an estimated dollar figure and surfaced as
  an alert rather than buried in a report.

### 3.4 Follow-through

- Lead funnel: captured → contacted → booked, with drop-off at each step
- Sequence performance and stalled `sequence_runs`

### 3.5 Onboarding readiness (first 30 days only)

A scored setup checklist shown to the owner during the first 30 days, then
retired from the view. Covers knowledge base coverage, calendar connection,
escalation contacts, business hours, and integration health.

Early churn is usually confusion rather than agent performance. This makes
incomplete setup visible to the client before it reads as a product failure.



A work queue, not a report. Items with actions, not charts.

- **Today's exceptions**: flagged calls, failed bookings, untouched
  escalations. Each shows assignee, age, and a resolve action.
- **Unreturned callbacks the agent promised.** A promise made by the agent and
  unkept by a human is the worst failure mode and is otherwise invisible.
- Live/recent call feed with transcript and recording, searchable by phone
  number
- Today vs. same weekday last week — enough context to notice a break, not a
  full analytics surface
- Calendar conflicts and double-book attempts

**Governing rule:** every item on this screen must be closable. If a manager
cannot act on it, it belongs in the owner view.

---

## 5. Admin / builder view

- **Versioned agent configuration.** Every change writes an audit entry with
  actor, timestamp, and before/after state. One-click revert to any prior
  version.
- **Diff-before-publish.** Show exactly what changes and what it affects before
  it goes live.
- **Sandbox test call** against the pending configuration prior to publish.
  Editing a live phone line without a test path is not acceptable to
  enterprise buyers.
- **Integration health**: CRM sync, calendar, telephony, webhook failures, each
  with a last-success timestamp.
- **Knowledge base editor**, fed directly by the gap list from §3.3.

### Voice prompt boundary

The voice prompt is not client-editable. This is represented as a visible,
explained boundary in the UI — a stated scope of what is client-managed versus
Gravvia-managed, plus a request path for changes outside it.

An unexplained absence reads as a product limitation. A stated boundary reads
as a quality guardrail, which is the accurate framing.

---

## 6. AI layer

The AI layer already attached to analytics is governed by three rules:

1. **Every claim is traceable.** Each insight links to the underlying call set.
   "Booking drop-offs rose 18% — here are the 23 calls." Insight that cannot be
   clicked through is decoration.
2. **Anomaly detection over summarization.** "Call volume normal, transfers
   doubled Tuesday" is the target output. Restating the charts in prose is not.
3. **Weekly digest by email** to the owner. Many owners will never log in; for
   them the digest is the product.

---

## 7. Cross-cutting requirements

### Multi-location
Rollup across locations with per-location drill-down, built on the existing
multi-tenant `client_settings` model. Location scoping applies to permission
grants.

### PHI and transcript handling
Hard requirement, not optional:

- Transcript and recording access gated by explicit permission grant
- Redaction on display for configured PHI fields
- Retention policy visible in the UI
- Every transcript view written to `audit_logs`

### Reporting
- CSV and PDF export on all owner-view clusters
- Scheduled recurring reports by email

### Semantic transcript search
Natural-language search across all transcripts, scoped by permission and
location — e.g. "everyone who asked about pricing for a service last month."
Results link to the underlying calls. Subject to the same PHI gating and
access logging as direct transcript viewing.

### White-label
Client logo, colors, and custom domain on the dashboard. Low build cost,
disproportionate effect on enterprise perception.

### Alerting
Threshold-based alerts (containment rate drop, integration down, escalation
spike, missed-revenue threshold) delivered by email, SMS, or Slack.

**Push notifications for high-intent leads** are a distinct path: mobile push
the moment a qualifying lead is captured. Most owners will not log in to find
this; the notification is the delivery mechanism. Qualification criteria are
configurable per client.

---

## 8. Data sources

All views read from existing tables. No new core schema; additive migrations
only, consistent with the locked-schema rule.

| Surface | Source |
|---|---|
| Call metrics, containment, flags | `calls`, `events` |
| Revenue attribution | `appointments`, `invoices`, KB pricing tables |
| Lead funnel | `contacts` (lead facade), `conversations` |
| Sequence performance | `sequence_runs` |
| Config history, transcript access log | `audit_logs` |
| Agent versions | `retell_resources` |
| Knowledge gaps | KB tables (services/pricing/faqs/promotions) |

Permission grants require one new additive table for role bundles and grants.

---

## 9. Out of scope

- Voice prompt editing by clients
- Replacing the GHL display layer for small clients — they remain on the
  existing dashboard
- Real-time call monitoring / barge-in
- Billing and subscription management UI
- **Peer benchmarking** (client performance vs. anonymized vertical averages).
  Deferred, not rejected. Requires meaningful tenant density within a single
  vertical plus explicit data-sharing consent; shipping it before then produces
  numbers that do not mean anything.

---

## 10. Success criteria

- An owner can state the dollar value of the agent within ten seconds of
  landing on the dashboard
- A manager can clear the day's exception queue without leaving the manager view
- An admin can change agent configuration, preview the diff, test it, publish
  it, and revert it — without Gravvia intervention
- A compliance reviewer can be granted transcript read access with no other
  capability, and every access is retrievable from `audit_logs`