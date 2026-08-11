# Apartment / Property Management Vertical Agent — Design

Date: 2026-08-11
Status: approved, ready for implementation plan

## Goal

Add an apartment complex vertical to Gravvia Engage: a leasing-office voice agent
that handles both populations a real leasing phone gets — prospects (availability,
rent, fees, tours, applications) and current residents (maintenance, rent and
portal questions, packages, parking, renewals) — plus a demo client seeded with
realistic fake pricing so the agent can be provisioned and called end to end.

This follows the vertical template pattern shipped 2026-08-06 (dental,
orthodontic, law firm, restaurant): a new template layered on
`inboundRoutingTemplate`, one registry line, one `resolveVertical` case. No
workflow-engine changes.

## The two rules that shape the template

Every vertical has one constraint that overrides ordinary helpfulness. This one
has two, and they are the reason the template is worth having rather than a
reskinned booking prompt.

### 1. Fair Housing (overrides hospitality; check every turn)

The agent must never:

- **Steer.** Questions like "is this a good area for kids?", "what kind of people
  live here?", "how are the schools?", "is the neighborhood safe?" are answered
  only with objective configured facts (address, what is on site, what is in
  POLICIES/FAQs) plus an offer to tour. The agent never characterizes the
  demographics, safety, or suitability of the property or neighborhood, and never
  recommends one building, floor, or area over another on those grounds.
- **Screen on protected class.** Never asks about, records, or repeats race,
  color, religion, sex, national origin, familial status (children, pregnancy),
  disability, or — where protected — source of income. If a caller volunteers
  any of it, the agent does not write it into slots or notes and does not let it
  change the answer.
- **Mishandle assistance animals.** Pet rent, pet fees, breed restrictions, and
  weight limits are NEVER applied to a service animal or assistance animal. The
  agent never says such an animal is not allowed, never demands documentation on
  the phone, and routes the question to the office.
- **Pre-approve or pre-deny.** Never "you'd qualify" / "that won't work" / "your
  income is too low." It reads the published screening criteria verbatim from
  configuration and routes the caller to the application.

Occupancy standards, screening criteria, and pet policy may be stated only as
configured, word for word, applied identically to every caller.

### 2. Maintenance emergency (safety hard rule; checked first, every turn)

Triggers: gas smell, fire or smoke, carbon monoxide alarm, active flooding or a
burst pipe, sewage backup, no heat in freezing weather, no A/C in dangerous heat,
no power, elevator entrapment, a broken exterior door or lock, or any threat to
personal safety.

Response: for gas, fire, CO, or immediate danger, say verbatim the instruction to
hang up and dial 911 (and the gas company for a gas smell). Then call
`emergency_flag` with a short description and hand off to the 24-hour emergency
maintenance line. Never troubleshoot, never schedule it as a routine work order,
never ask qualifying questions first.

## Additional guardrails

- **Pricing is perishable.** Any rent quoted is framed as "as of today, subject to
  availability and change." The agent never guarantees a rate, never holds or
  reserves a unit, and never quotes a specific unit number as available unless it
  is in configuration.
- **No payments by phone.** Never takes a card or bank number, never processes an
  application fee, deposit, or rent payment. Routes to the resident portal or the
  office.
- **Resident account data needs identity.** `verify_identity` before any balance,
  lease end date, work-order status, notice, or document request.
- **Legal matters go to a human.** Eviction, lease-break, notice to vacate,
  deposit disputes, habitability complaints, ADA/accommodation requests, and
  anything involving a lawyer route to staff. The agent never interprets the
  lease and never quotes a lease clause it was not given.

## Intents

Mapped to already-registered workflows so routing actually fires:

| Caller need | Intent |
| --- | --- |
| Tour (in-person or self-guided) | `book_appointment` |
| Change / cancel a tour | `reschedule_appointment`, `cancel_appointment` |
| Prospect capture | `lead_qualification` |
| Rent, fees, deposits | `pricing` |
| Hours, pets, parking, amenities, policies | `faq` |
| Floor plan unavailable | `waitlist` |
| Rent balance, late fee, portal | `payment_questions` |
| Lease copy, ledger, proof of residency | `documentation_requests` |
| Noise, neighbor, service complaint | `complaint` |
| Callback, human, goodbye | `callback_request`, `staff_transfer`, `end_call` |
| Emergency | `emergency` |

**Known gap:** there is no maintenance-request workflow among the 25, and a work
order is the most common resident call. It routes through the engine's fallback
contract (`route_intent` with an unregistered label grants the fallback scopes),
with the agent collecting unit number, the issue, permission to enter, pets in
the unit, and a callback number, then leaving a staff message. This works today.
A dedicated `maintenance-request.workflow.ts` is the cleaner follow-up and is
explicitly out of scope for this change.

## New AgentConfig flags

Behavior gates only — prices live in the `pricing` catalog, rules live in
`business_policies`. Following the existing vertical-flag convention (unset means
"not offered"):

- `tours_enabled?: boolean` — agent may book tours
- `self_guided_tours?: boolean` — self-guided option exists
- `online_application_url?: string`
- `resident_portal_url?: string`
- `emergency_maintenance_line?: string`
- `application_fee?: number`
- `admin_fee?: number`
- `income_requirement_multiple?: number` — e.g. 3 for "3x the rent"
- `pets_allowed?: boolean`

## Demo client — Harborview Apartments

Seeded as `supabase/data/011_harborview_apartments.sql`, idempotent, matching the
shape of `010_nonnas_table.sql`. Fake but realistic:

- Studio $1,395 · 1BR $1,595–1,750 · 2BR $2,050–2,295 · 3BR $2,650
- Application fee $60 per adult 18+, admin fee $200, security deposit $500 or one
  month's rent based on screening
- Pet fee $350 non-refundable + $35/month pet rent, 2 pets max, breed
  restrictions listed in policy
- Garage parking $125/month, storage $45/month, month-to-month premium $300
- Late fee $75 after the 5th, 12-month standard lease, 3x income requirement,
  60-day notice to vacate

`services` holds what can be BOOKED (tour types, application appointment), not the
floor plans; floor plans and fees live in `pricing` and `faqs`, which is what
`knowledge_search` reads.

## Registry wiring

`resolveVertical('real_estate')` → `'apartment_routing'`.

Risk: this changes what an existing `real_estate` client receives on its next
re-provision. Verify no live client uses that industry before making the change;
if one does, leave `resolveVertical` untouched and rely on the explicit
`--template=apartment_routing` provisioning override.

## Testing

Extend `backend/src/__tests__/vertical-templates.test.ts`:

- template registers and builds for `apartment_routing`
- Fair Housing block present; steering, protected-class, and assistance-animal
  language asserted
- maintenance emergency script present and unconditional
- pricing disclaimer and no-payments-by-phone rules present
- flags gate correctly: tours off, pets off, no portal/application URL configured
- `resolveVertical('real_estate')` → `'apartment_routing'`; all other industries
  resolve exactly as before

## Deliverables

1. `backend/src/providers/retell/templates/apartment-routing.template.ts`
2. Registry + `resolveVertical` wiring in `templates/index.ts`
3. New flags on `AgentConfig` in `backend/src/types/client.types.ts`
4. `supabase/data/011_harborview_apartments.sql`
5. Tests in `backend/src/__tests__/vertical-templates.test.ts`
6. Provision the demo agent to Retell

Note: the Retell account returned 402 "Payment overdue, service stopped" on
2026-08-09. Provisioning is expected to fail until billing is settled; everything
through step 5 is unaffected.
