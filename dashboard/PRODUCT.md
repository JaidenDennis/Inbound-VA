# Product

<!-- impeccable:product-schema 1 -->

> Provenance: this record was written from repository evidence (root `CLAUDE.md`,
> `backend/`, `dashboard/src/`) and the redesign brief, not from a live interview.
> The user chose an end-to-end run over an interview round. Facts below are drawn
> from code and the build spec; anything marked `[INFERRED]` is a hypothesis the
> repository implies but no human confirmed.

## Platform

web

## Users

Two distinct shells behind one codebase, split by role family:

- **Platform staff** (Gravvia operators). Sit in the dashboard for long stretches
  across many client tenants. Jobs: watch inbound call traffic, catch failing
  jobs and CRM syncs before a client notices, provision and tune voice agents,
  work support tickets against an SLA clock, onboard new clients.
- **Client users** (the businesses buying the service: med spas, dental and
  ortho practices, law firms, restaurants). Visit occasionally to answer a
  narrower question: did we catch our calls, what did the agent say, what is
  booked, what does the agent know about us.

Navigation, permissions, and available routes differ per shell (`Sidebar.tsx`,
`lib/session.ts`). Staff see 13 routes grouped Operate / Clients / System;
clients see 6 flat.

## Product Purpose

Gravvia Engage is a multi-tenant AI voice operations platform. Retell AI is the
voice layer; the backend owns all business logic, workflow, storage, CRM
integration, and booking. The dashboard is the operator surface over that
system: it is where the platform's state becomes legible and where client
configuration is changed.

Success for staff is catching a problem before the client calls about it.
Success for a client is a five-minute answer to "is this working."

## Positioning

The architectural commitment a competitor could not truthfully copy:
**Retell talks, the backend decides, the database remembers, the CRM displays.**
No business logic lives in the voice provider, and no client-specific logic
lives in source code. Every tenant difference is a database record, so one
codebase serves a dentist on HubSpot, a med spa on GoHighLevel with booking
off, and a law firm on Salesforce requiring human transfer.

## Operating Context

- Deployed on Render; Supabase Postgres; Redis + BullMQ for queues; Fastify API.
- Live production URL: `inbound-va-dashboard.onrender.com`.
- Real live tenants exist, including a med spa running agent "Emily" on a real
  inbound number.
- Every provider webhook is normalized to an event; expensive work runs on
  queues with retries. Exhausted retries land in `MANUAL_REVIEW`, which is a
  state a human must find and clear in this dashboard.
- Staff work is interrupt-driven and comparative: the question is usually
  "which of these is worst" across a list, not "tell me about this one".
- The System Health route already grades activity by `severity`
  (`fatal` / `error` / `warn`) and by `reviewed_at`; the Audit Log records
  actor-attributed changes.

## Capabilities and Constraints

- Stack is fixed: Next.js App Router, TypeScript, Tailwind, Recharts,
  `lucide-react` icons, `react-hot-toast`. Not up for renegotiation in a
  visual pass.
- Charts already ship a validated data-viz token layer in `globals.css`
  (`.viz-root`, categorical slots 1-2, CVD-checked). Preserve it.
- Existing accessibility wins that must not regress: status is icon + word,
  never color alone (`StatusPill.tsx`); skip-to-content link; focus-visible
  rings; `aria-current` on nav; sr-only table captions; nav skeleton reserves
  space to prevent layout shift.
- Routes, slugs, permission gates, and API contracts are fixed. This is a visual
  replacement, not an IA change.
- Data is real tenant data including call transcripts. Credentials and caller
  PII are stripped before error context is stored.

## Brand Commitments

- Name: **Gravvia Engage**. Wordmark currently rendered as a "GE" monogram tile.
- The product describes itself as "AI Voice Operations".
- Binding constraint from the redesign brief: the surface must read as
  **extremely professional** while signaling **frontier AI**. Professionalism
  wins where the two conflict.
- Binding constraint from the redesign brief: log severity must be readable as
  **green = good, yellow = fair, red = bad** status lights.

## Evidence on Hand

- Real routes, real permission model, real API shapes in `dashboard/src/lib/api.ts`.
- Real severity and sync vocabularies already in code.
- No customer logos, testimonials, case studies, pricing, uptime figures, or
  certifications exist in the repository. The current login page asserts
  "SOC 2-aligned" and "Enterprise-grade security"; **no evidence in the
  repository substantiates these**, so they must not be carried forward or
  expanded without the user confirming them. `[INFERRED]` that this copy was
  aspirational.

## Product Principles

1. **State before decoration.** The operator's first question is always "what is
   wrong right now"; the design's job is to answer it before anything else.
2. **One codebase, many tenants.** Nothing visual may assume a specific client,
   industry, or configuration.
3. **Color reinforces, never carries.** Severity must survive greyscale,
   color-blindness, and a screenshot pasted into a ticket.
4. **Density is a feature.** These are comparison surfaces. Whitespace that
   reduces how many rows an operator can scan is a cost, not a virtue.
5. **Never fabricate trust.** Security, compliance, and customer claims come
   from supplied truth or do not ship.

## Accessibility & Inclusion

- WCAG AA contrast minimum for body and placeholder text.
- Status and severity must be conveyed redundantly (icon + label + color).
- Full keyboard operability with a visible focus ring on every interactive
  element; tab order matches visual order.
- `prefers-reduced-motion` must collapse all motion.
