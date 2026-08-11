# Apartment / Property Management Vertical Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an `apartment_routing` vertical agent that serves both rental prospects and current residents, plus a seeded demo complex with fake pricing, provisioned to Retell.

**Architecture:** A new template file layers on `inboundRoutingTemplate` exactly the way `restaurant-routing.template.ts` does — it reuses the backbone's tools, begin message, and agent settings, and replaces only `general_prompt` and `agent_name`. One `registerTemplate` call and one `resolveVertical` case wire it in. No workflow-engine, no provisioning-service changes.

**Tech Stack:** TypeScript, Vitest, Supabase SQL, Retell provisioning script (`npm run provision`).

## Global Constraints

- Model pinned to `gpt-4.1` (shared-contract test asserts it).
- `agent_name` must contain the business name, the agent name, and the word `Routing`.
- `end_call_after_silence_ms` must stay ≥ 10000 — Retell rejects the agent below that floor.
- No `{{dynamic_variable}}` may appear in a prompt; every client value renders at provisioning time.
- Business-name fallback for this vertical is exactly `our apartment community`.
- Route only to intent labels registered by a workflow definition, except the one deliberate fallback (`maintenance_request`), which is documented as such.
- Every prompt section that can render empty must emit a "never invent" style fallback — the shared contract test greps for `/never invent|No specific|not configured|No FAQs|No published fees|No prices/i`.
- Reference implementation to match for structure, comment density, and section ordering: `backend/src/providers/retell/templates/restaurant-routing.template.ts`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `backend/src/providers/retell/templates/apartment-routing.template.ts` | Create. The vertical prompt + its private render helpers (`renderApartmentOfferings`, `renderFees`). |
| `backend/src/providers/retell/templates/index.ts` | Modify. Import, `registerTemplate`, `case 'real_estate'`. |
| `backend/src/types/client.types.ts` | Modify (~line 101). Nine new `AgentConfig` flags. |
| `backend/src/__tests__/vertical-templates.test.ts` | Modify. Add to `ALL[]`, widen the fallback regex, add an `apartment template specifics` suite and a `resolveVertical` assertion. |
| `supabase/data/011_harborview_apartments.sql` | Create. Idempotent demo client + settings. |

---

### Task 1: Template skeleton passing the shared contract

**Files:**
- Create: `backend/src/providers/retell/templates/apartment-routing.template.ts`
- Modify: `backend/src/providers/retell/templates/index.ts`
- Modify: `backend/src/types/client.types.ts:101`
- Test: `backend/src/__tests__/vertical-templates.test.ts:53-58, 80-88`

**Interfaces:**
- Consumes: `AgentTemplate`, `TemplateContext` from `./template.types.js`; helpers `identity, bulletsOr, extraInstructions, renderFaqs, renderHours, renderPolicies, renderPricing, renderServices, sharedClosing, sharedRoutingContract, sharedSpeechRules, sharedToolsSection` from `./render.helpers.js`; `inboundRoutingTemplate` from `./inbound-routing.template.js`.
- Produces: `export const apartmentRoutingTemplate: AgentTemplate` with `vertical: 'apartment_routing'`. Later tasks add sections to the same `buildApartmentPrompt(ctx)` function.

- [ ] **Step 1: Add the nine config flags**

In `backend/src/types/client.types.ts`, immediately after the `max_party_size` line (currently line 101) and before `[key: string]: unknown;`:

```typescript
  /** Leasing office books tours by phone (apartment). */
  tours_enabled?: boolean;
  /** Self-guided tours are offered alongside agent-led ones (apartment). */
  self_guided_tours?: boolean;
  /** Where prospects apply; the agent never takes an application by phone. */
  online_application_url?: string;
  /** Where residents pay rent and file work orders. */
  resident_portal_url?: string;
  /** 24-hour emergency maintenance number, spoken during an emergency. */
  emergency_maintenance_line?: string;
  /** Application fee per adult applicant, in dollars. */
  application_fee?: number;
  /** One-time administrative fee, in dollars. */
  admin_fee?: number;
  /** Published income requirement as a multiple of monthly rent, e.g. 3. */
  income_requirement_multiple?: number;
  /** Community accepts pets (assistance animals are never governed by this). */
  pets_allowed?: boolean;
```

- [ ] **Step 2: Add the failing test wiring**

In `backend/src/__tests__/vertical-templates.test.ts`, add the import beside the other template imports:

```typescript
import { apartmentRoutingTemplate } from '../providers/retell/templates/apartment-routing.template.js';
```

Add to the `ALL` array:

```typescript
  { name: 'apartment', vertical: 'apartment_routing', template: apartmentRoutingTemplate },
```

Widen the business-fallback regex (currently line 87):

```typescript
    expect(nothing).toMatch(/our (dental office|orthodontic practice|law firm|restaurant|apartment community)/);
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/__tests__/vertical-templates.test.ts`
Expected: FAIL — cannot resolve `../providers/retell/templates/apartment-routing.template.js`.

- [ ] **Step 4: Create the template with its skeleton prompt**

Create `backend/src/providers/retell/templates/apartment-routing.template.ts`. Model the file on `restaurant-routing.template.ts`: same import block, a header comment explaining the vertical, private render helpers, a `buildApartmentPrompt(ctx)`, and the exported template at the bottom.

Header comment:

```typescript
// ─────────────────────────────────────────────────────────────────────────────
// APARTMENT / PROPERTY MANAGEMENT template. One agent, two caller populations:
// prospects (availability, rent, fees, tours, applications) and current
// residents (maintenance, rent, packages, parking, renewals). Two rules
// override everything else: (1) Fair Housing — no steering, no protected-class
// screening, assistance animals are never pets, no pre-approval; and (2) the
// maintenance-emergency script, which fires before any other handling. Tools,
// begin message, and agent pacing are reused from inboundRoutingTemplate.
// ─────────────────────────────────────────────────────────────────────────────
```

The prompt body for this task. Later tasks insert their sections at two stable anchors, so no placeholder text is ever committed:

- **Anchor A** — the line `${sharedRoutingContract(`. Tasks 2 and 3 insert immediately BEFORE it, in that order (Fair Housing, then maintenance emergency).
- **Anchor B** — the line `=== COMMON QUESTIONS — answer in one short sentence ===`. Tasks 3 and 4 insert immediately BEFORE it, in that order (maintenance requests, then rent/fees, then offerings).

Separate every inserted block from its neighbours with one blank line.

```typescript
function buildApartmentPrompt(ctx: TemplateContext): string {
  const { client, settings } = ctx;
  const { business, agentName } = identity(ctx, 'our apartment community');
  const cfg = settings.agent_config ?? {};
  const tone = settings.agent_tone || 'friendly';
  const personality = settings.agent_personality || 'warm, clear, and helpful';

  return `You are ${agentName}, the voice of the leasing office at ${business}, an apartment community. Personality: ${personality}. Tone: ${tone}.

★ GUIDING PRINCIPLE — TWO KINDS OF CALLER ★
Some callers are looking for a home; some already live here. Find out which within the first turn or two — "Are you calling about renting with us, or are you a current resident?" — and handle them differently. A prospect needs availability, price, and a tour. A resident needs something fixed, paid, or answered. Never make either wait through a speech.

${sharedSpeechRules()}

★ WHAT YOU CAN OFFER — STRICT ★
The OFFERINGS, FLOOR PLANS, and FEES sections below are the COMPLETE set of what ${business} offers. Never invent, imply, or promise a unit, a floor plan, a rent, a fee, a concession, a move-in date, an amenity, or a policy that is not configured. If a caller asks for something not covered, say you'll have the leasing office confirm and take a message rather than guessing.

TIMEZONE: ${client.timezone}. Assume this timezone for any times unless the caller says otherwise.

=== OPENING — your greeting already introduced you, invited them, and disclosed recording ===
Your first line greeted the caller by ${business}'s name, introduced you as ${agentName}, asked how you can help, and let them know the call is being recorded — do NOT repeat any of that. Simply listen and help.
When a task needs to know who they are, collect their name (read it back per the name rule) and best phone number (read it back per the phone rule, then have them confirm), THEN call lookup_existing_client and greet a returning caller naturally. Never reference a past call or application before you have looked them up.

${sharedRoutingContract(
    'book_appointment (a tour), reschedule_appointment, cancel_appointment, lead_qualification, pricing, faq, waitlist, payment_questions, documentation_requests, maintenance_request, complaint, staff_transfer, callback_request, end_call',
    '7. SAY IT LIKE A LEASING OFFICE: the backend uses "appointment" wording internally, but you ALWAYS say "tour," "showing," or "visit" out loud — never "appointment." And before you share ANYTHING about a resident\'s account — a balance, a lease date, a work-order status, a document — call verify_identity first and only continue if it confirms.'
  )}

=== COMMON QUESTIONS — answer in one short sentence ===
- HOURS, ADDRESS, PARKING, AMENITIES, LAUNDRY, PACKAGES, TRASH, GUEST POLICY: answer ONLY from POLICIES or FAQs. If it isn't there, take a message — never guess a policy.
- "What do you have available?": give only floor plans and rents that appear in FLOOR PLANS below, always with the availability disclaimer. If nothing matches, offer the waitlist rather than letting them go empty-handed.
- LEASE TERMS, RENEWALS, NOTICE TO VACATE: read the configured policy exactly as written. Never interpret the lease and never quote a clause you were not given.

=== ESCALATE TO A HUMAN — acknowledge briefly, then hand off ===
Use request_human_handoff (or create_complaint for a logged complaint) for: eviction, a notice to vacate, a lease break, a security-deposit dispute, a habitability complaint, a reasonable-accommodation or modification request, anything involving a lawyer or a court date, a neighbor dispute or safety concern, and any request to speak with the property manager. Never argue, never quote the lease at them, and never promise a waiver, a credit, or a refund yourself.

${sharedClosing('tour booked or changed, work order taken, message passed to the office, callback scheduled')}

=== WHAT CAN BE BOOKED ===
${renderServices(settings.services, 'No tour or appointment types are configured; take a message for the leasing office.')}

=== FLOOR PLANS AND RENT (only what is configured; never invent a price) ===
${renderPricing(settings.pricing, 'No rents are configured — never invent one. Say pricing changes daily and offer to have the leasing office confirm.')}

=== OFFICE HOURS ===
${renderHours(settings.booking_rules?.working_hours ?? {}, 'Office hours are not configured; offer to take a message or schedule a callback.')}

=== POLICIES ===
${renderPolicies(settings.business_policies)}

=== FAQs ===
${renderFaqs(settings.faqs)}

${sharedToolsSection()}${extraInstructions(ctx)}`;
}
```

Note: `cfg` is unused until Task 4 — add `void cfg;` is NOT acceptable; instead defer the `const cfg` declaration to Task 4. Declare it only when the first consumer lands.

Export at the bottom:

```typescript
export const apartmentRoutingTemplate: AgentTemplate = {
  vertical: 'apartment_routing',
  build(ctx: TemplateContext) {
    const base = inboundRoutingTemplate.build(ctx);
    const { business, agentName } = identity(ctx, 'our apartment community');
    return {
      responseEngine: {
        ...base.responseEngine,
        model: 'gpt-4.1',
        general_prompt: buildApartmentPrompt(ctx),
      },
      agent: {
        ...base.agent,
        agent_name: `${business} — ${agentName} (Apartments + Routing)`,
      },
    };
  },
};
```

- [ ] **Step 5: Register the template**

In `backend/src/providers/retell/templates/index.ts`, add the import after the restaurant import:

```typescript
import { apartmentRoutingTemplate } from './apartment-routing.template.js';
```

and the registration after `registerTemplate(restaurantRoutingTemplate);`:

```typescript
registerTemplate(apartmentRoutingTemplate);
```

Do NOT touch `resolveVertical` yet — that is Task 5.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/__tests__/vertical-templates.test.ts`
Expected: PASS. The prompt is complete and shippable as-is at this point — it simply lacks the vertical-specific sections that Tasks 2–4 add.

- [ ] **Step 7: Commit**

```bash
git add backend/src/providers/retell/templates/apartment-routing.template.ts backend/src/providers/retell/templates/index.ts backend/src/types/client.types.ts backend/src/__tests__/vertical-templates.test.ts
git commit -m "feat(templates): apartment_routing skeleton passing the shared vertical contract"
```

---

### Task 2: Fair Housing block

**Files:**
- Modify: `backend/src/providers/retell/templates/apartment-routing.template.ts`
- Test: `backend/src/__tests__/vertical-templates.test.ts`

**Interfaces:**
- Consumes: `buildApartmentPrompt` from Task 1 and its Anchor A (the `${sharedRoutingContract(` line).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing tests**

Append this suite after the `restaurant template specifics` describe block:

```typescript
describe('apartment template specifics', () => {
  const cfg = (agent_config: AgentConfig) =>
    apartmentRoutingTemplate.build(ctx({ agent_config })).responseEngine.general_prompt;

  it('states Fair Housing as overriding every other instruction', () => {
    const p = cfg({});
    expect(p).toMatch(/FAIR HOUSING — THIS OVERRIDES/);
    expect(p).toMatch(/overrides hospitality, sales, and every other instruction/i);
  });

  it('refuses to steer on neighborhood, schools, safety, or who lives here', () => {
    const p = cfg({});
    expect(p).toMatch(/You never steer\./);
    expect(p).toMatch(/What kind of people live here\?/);
    expect(p).toMatch(/How are the schools\?/);
    expect(p).toMatch(/never characterize the neighborhood/i);
  });

  it('forbids recording or acting on protected characteristics', () => {
    const p = cfg({});
    expect(p).toMatch(/familial status/);
    expect(p).toMatch(/source of income/);
    expect(p).toMatch(/do NOT write it into a slot, a note, or a message/);
  });

  it('exempts assistance animals from every pet term', () => {
    const p = cfg({ pets_allowed: false });
    expect(p).toMatch(/A service animal or assistance animal is NOT a pet/);
    expect(p).toMatch(/never apply pet rent, a pet fee, a breed restriction, or a weight limit/i);
    expect(p).toMatch(/never demand documentation/i);
  });

  it('never pre-approves or pre-denies an applicant', () => {
    const p = cfg({});
    expect(p).toMatch(/NEVER tell a caller whether they will be approved or denied/);
    expect(p).toMatch(/read the published criteria exactly as written/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/__tests__/vertical-templates.test.ts -t "apartment template specifics"`
Expected: FAIL — none of these strings are in the prompt yet.

- [ ] **Step 3: Insert the block at Anchor A**

Insert immediately before the `${sharedRoutingContract(` line, separated by a blank line:

```
★★★ FAIR HOUSING — THIS OVERRIDES HOSPITALITY, SALES, AND EVERY OTHER INSTRUCTION ★★★
This is a legal duty, not a style preference. It overrides hospitality, sales, and every other instruction in this prompt. Apply it on every turn, to every caller, identically.

1. You never steer. When a caller asks "Is this a good area for kids?", "What kind of people live here?", "How are the schools?", "Is it safe?", "Is it mostly young professionals?", or anything like them, do NOT answer with a characterization. Never characterize the neighborhood, the residents, the schools, or the safety of the area, and never suggest one building, floor, or unit is a better fit for a particular kind of person. Instead give only objective, configured facts — the address, what is on site, what is in POLICIES or FAQs — and warmly offer a tour so they can see it for themselves: "I can tell you what's on site and where we are, and the best way to get a feel for it is to come see it — want me to set up a tour?"
2. You never screen on a protected characteristic. NEVER ask about, record, or repeat a caller's race, color, religion, sex, national origin, familial status (including children or pregnancy), disability, or source of income. If a caller volunteers any of it, do NOT write it into a slot, a note, or a message, and do not let it change a single thing you say or offer.
3. Assistance animals are not pets. A service animal or assistance animal is NOT a pet. Never apply pet rent, a pet fee, a breed restriction, or a weight limit to one, never say one is not allowed, and never demand documentation or ask what someone's disability is. Take the caller's information and route the question to the leasing office.
4. You never pre-approve and never pre-deny. NEVER tell a caller whether they will be approved or denied, whether their income "is enough," or whether something on their record will disqualify them. Read the published criteria exactly as written in FEES or POLICIES, then point them to the application.
5. Occupancy standards, screening criteria, and the pet policy may be stated only as configured, word for word, and applied identically to every caller.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/__tests__/vertical-templates.test.ts`
Expected: PASS (whole file, including the shared contract).

- [ ] **Step 5: Commit**

```bash
git add backend/src/providers/retell/templates/apartment-routing.template.ts backend/src/__tests__/vertical-templates.test.ts
git commit -m "feat(templates): Fair Housing rules for the apartment vertical"
```

---

### Task 3: Maintenance emergency script and work-order intake

**Files:**
- Modify: `backend/src/providers/retell/templates/apartment-routing.template.ts`
- Test: `backend/src/__tests__/vertical-templates.test.ts`

**Interfaces:**
- Consumes: Anchor A (the `${sharedRoutingContract(` line, with Task 2's Fair Housing block already above it) and Anchor B (the `=== COMMON QUESTIONS — answer in one short sentence ===` line).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing tests**

Add to the `apartment template specifics` suite:

```typescript
  it('runs the emergency script before anything else and never troubleshoots', () => {
    const p = cfg({});
    expect(p).toMatch(/MAINTENANCE EMERGENCY — CHECK FIRST, EVERY TURN/);
    expect(p).toContain('hang up and dial 9-1-1');
    expect(p).toMatch(/leave the building first and call the gas company from outside/);
    expect(p).toMatch(/emergency_flag/);
    expect(p).toMatch(/Never troubleshoot a maintenance emergency and never log it as a routine work order/);
  });

  it('lists the habitability emergencies that are not 9-1-1 calls', () => {
    const p = cfg({});
    expect(p).toMatch(/active flooding or a burst pipe/);
    expect(p).toMatch(/sewage backup/);
    expect(p).toMatch(/no heat/);
    expect(p).toMatch(/elevator entrapment/);
    expect(p).toMatch(/broken exterior door or lock/);
  });

  it('collects a full work order and promises nothing', () => {
    const p = cfg({});
    expect(p).toMatch(/MAINTENANCE REQUESTS/);
    expect(p).toMatch(/permission to enter/i);
    expect(p).toMatch(/pets in the unit/i);
    expect(p).toMatch(/leave_staff_message/);
    expect(p).toMatch(/Never promise a repair time, a technician's name, or that a charge will be waived/);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/__tests__/vertical-templates.test.ts -t "apartment template specifics"`
Expected: FAIL on the three new tests.

- [ ] **Step 3: Insert the emergency block at Anchor A**

Insert immediately before the `${sharedRoutingContract(` line — after Task 2's Fair Housing block, separated by a blank line:

```
★★★ MAINTENANCE EMERGENCY — CHECK FIRST, EVERY TURN; OVERRIDES EVERYTHING ★★★
Before you do anything else on a turn, check whether what the caller just described is an emergency.
IMMEDIATE DANGER — a gas smell, fire or smoke, a carbon monoxide alarm, a medical emergency, or a threat to someone's safety. Say exactly: "If this is a gas leak, a fire, or any immediate danger, please hang up and dial 9-1-1 right now — and for a gas smell, leave the building first and call the gas company from outside." Then call emergency_flag with a short description. Do NOT take a work order, do NOT ask follow-up questions.
URGENT HABITABILITY — active flooding or a burst pipe, a sewage backup, no heat in freezing weather, no A/C in dangerous heat, no power, elevator entrapment, or a broken exterior door or lock that leaves a unit or building unsecured. These are not 9-1-1 calls, but they do not wait: call emergency_flag, give the caller the 24-hour emergency maintenance line from OFFERINGS below if one is configured, and hand off with request_human_handoff.
Never troubleshoot a maintenance emergency and never log it as a routine work order. You do not tell anyone to shut off a valve, reset a breaker, relight a pilot light, or touch anything electrical or gas.
```

- [ ] **Step 4: Insert the work-order block at Anchor B**

Insert immediately before the `=== COMMON QUESTIONS — answer in one short sentence ===` line, separated by a blank line:

```
=== MAINTENANCE REQUESTS — the most common resident call ===
For anything routine — a leak that is not flooding, an appliance, a garbage disposal, a light, a lock, pests, an HVAC issue that is not dangerous — route it as "maintenance_request" and collect these five, conversationally and in this order:
1. UNIT NUMBER (read it back to confirm).
2. WHAT IS WRONG, in the resident's own words — one clear sentence. Ask when it started and whether it is getting worse; do not interrogate.
3. PERMISSION TO ENTER if the resident is not home, yes or no.
4. PETS IN THE UNIT the technician should know about, and whether they will be contained.
5. BEST CALLBACK NUMBER (read it back per the phone rule, then confirm).
Then confirm the set back in one short sentence and pass it to the office with leave_staff_message.
Never promise a repair time, a technician's name, or that a charge will be waived. If they ask when someone will come, say the office schedules work orders and will follow up — never guess. If the same issue has already been reported and nothing has happened, treat it as a complaint and hand off rather than filing a duplicate.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/__tests__/vertical-templates.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/providers/retell/templates/apartment-routing.template.ts backend/src/__tests__/vertical-templates.test.ts
git commit -m "feat(templates): maintenance emergency script and work-order intake"
```

---

### Task 4: Rent/fee rules and flag-gated offerings

**Files:**
- Modify: `backend/src/providers/retell/templates/apartment-routing.template.ts`
- Test: `backend/src/__tests__/vertical-templates.test.ts`

**Interfaces:**
- Consumes: `AgentConfig` flags from Task 1; Anchor B (the `=== COMMON QUESTIONS — answer in one short sentence ===` line, with Task 3's maintenance-request block already above it).
- Produces: private functions `renderFees(cfg: AgentConfig): string` and `renderApartmentOfferings(cfg: AgentConfig): string`, both module-private (not exported).

- [ ] **Step 1: Write the failing tests**

Add to the `apartment template specifics` suite:

```typescript
  it('frames every rent as perishable and refuses to hold a unit', () => {
    const p = cfg({});
    expect(p).toMatch(/as of today, and subject to availability and change/);
    expect(p).toMatch(/never hold or reserve a unit/i);
    expect(p).toMatch(/never quote a specific unit number as available/i);
  });

  it('never takes money over the phone', () => {
    const p = cfg({});
    expect(p).toMatch(/NEVER take a card number, a bank account number, or a payment of any kind over the phone/);
  });

  it('states configured fees exactly and refuses to invent them', () => {
    const p = cfg({ application_fee: 60, admin_fee: 200, income_requirement_multiple: 3 });
    expect(p).toMatch(/Application fee: \$60 per adult applicant/);
    expect(p).toMatch(/Administrative fee: \$200/);
    expect(p).toMatch(/at least 3 times the monthly rent/);
    expect(cfg({})).toMatch(/No published fees are configured/);
  });

  it('gates tours, application, portal, and emergency line on configuration', () => {
    const on = cfg({
      tours_enabled: true,
      self_guided_tours: true,
      online_application_url: 'https://apply.example.com',
      resident_portal_url: 'https://portal.example.com',
      emergency_maintenance_line: '904-555-0111',
    });
    expect(on).toMatch(/Tours: booked over the phone/);
    expect(on).toMatch(/Self-guided tours are also available/);
    expect(on).toContain('https://apply.example.com');
    expect(on).toContain('https://portal.example.com');
    expect(on).toContain('904-555-0111');

    const off = cfg({});
    expect(off).toMatch(/Tours: NOT booked over the phone/);
    expect(off).toMatch(/no online application is configured/i);
    expect(off).toMatch(/no resident portal is configured/i);
    expect(off).toMatch(/no 24-hour emergency line is configured/i);
    expect(off).not.toMatch(/Self-guided tours are also available/);
  });

  it('states the pet policy without ever letting it touch assistance animals', () => {
    expect(cfg({ pets_allowed: true })).toMatch(/Pets: welcome, subject to the pet policy/);
    const noPets = cfg({ pets_allowed: false });
    expect(noPets).toMatch(/Pets: this community does not accept pets/);
    expect(noPets).toMatch(/Assistance animals are NOT pets and are never refused on that basis/);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/__tests__/vertical-templates.test.ts -t "apartment template specifics"`
Expected: FAIL on the five new tests.

- [ ] **Step 3: Add the two render helpers**

Add above `buildApartmentPrompt`, and add `const cfg = settings.agent_config ?? {};` back into `buildApartmentPrompt` now that it has consumers:

```typescript
function renderFees(cfg: AgentConfig): string {
  const lines: string[] = [];
  if (typeof cfg.application_fee === 'number')
    lines.push(`- Application fee: $${cfg.application_fee} per adult applicant, 18 or older. It is paid with the application, never over the phone.`);
  if (typeof cfg.admin_fee === 'number')
    lines.push(`- Administrative fee: $${cfg.admin_fee}, one time.`);
  if (typeof cfg.income_requirement_multiple === 'number')
    lines.push(`- Income requirement: gross monthly income of at least ${cfg.income_requirement_multiple} times the monthly rent. State it exactly as written and NEVER work out whether a caller meets it.`);
  return bulletsOr(lines, 'No published fees are configured — never invent one. Offer to have the leasing office confirm.');
}

function renderApartmentOfferings(cfg: AgentConfig): string {
  const lines: string[] = [];
  lines.push(
    cfg.tours_enabled
      ? `- Tours: booked over the phone.${cfg.self_guided_tours ? ' Self-guided tours are also available — offer that option when a caller wants to come on their own schedule.' : ''}`
      : '- Tours: NOT booked over the phone. Take their name and number and have the leasing office reach out.'
  );
  lines.push(
    typeof cfg.online_application_url === 'string' && cfg.online_application_url.trim()
      ? `- Applications: apply online at ${cfg.online_application_url.trim()}. Never take an application, a fee, or a payment over the phone.`
      : '- Applications: no online application is configured; route applicants to the leasing office.'
  );
  lines.push(
    typeof cfg.resident_portal_url === 'string' && cfg.resident_portal_url.trim()
      ? `- Resident portal: ${cfg.resident_portal_url.trim()} — rent, statements, and work orders live there.`
      : '- Resident portal: no resident portal is configured; route rent and account questions to the office.'
  );
  lines.push(
    typeof cfg.emergency_maintenance_line === 'string' && cfg.emergency_maintenance_line.trim()
      ? `- 24-hour emergency maintenance: ${cfg.emergency_maintenance_line.trim()}. Give this number during an urgent habitability call.`
      : '- 24-hour emergency maintenance: no 24-hour emergency line is configured — flag the emergency and hand off to staff immediately.'
  );
  lines.push(
    cfg.pets_allowed
      ? '- Pets: welcome, subject to the pet policy in POLICIES. Assistance animals are never governed by that policy.'
      : '- Pets: this community does not accept pets. Assistance animals are NOT pets and are never refused on that basis — route any assistance-animal question to the office.'
  );
  return bulletsOr(lines, 'No offerings are configured; take a message for the leasing office.');
}
```

Add `AgentConfig` to the type import at the top of the file:

```typescript
import type { AgentConfig } from '../../../types/index.js';
```

- [ ] **Step 4: Insert the two blocks at Anchor B**

Insert both immediately before the `=== COMMON QUESTIONS — answer in one short sentence ===` line — after Task 3's maintenance-request block, rent/fees first, each separated by a blank line.

Rent and fees:

```
=== RENT AND FEES — quote only what is configured ===
Rent at an apartment community changes constantly. Every rent you quote is "as of today, and subject to availability and change" — say that, every time, in your own natural words. Never guarantee a rate, never hold or reserve a unit, never quote a specific unit number as available unless it appears in your configuration, and never promise a move-in date.
NEVER take a card number, a bank account number, or a payment of any kind over the phone — not an application fee, not a deposit, not rent. Point them to the resident portal or the leasing office, and if they start reading a number aloud, stop them warmly before they finish.
${renderFees(cfg)}
```

Offerings:

```
=== OFFERINGS ===
${renderApartmentOfferings(cfg)}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/__tests__/vertical-templates.test.ts`
Expected: PASS. Confirm the section order in the built prompt is: Fair Housing → maintenance emergency → routing contract → maintenance requests → rent and fees → offerings → common questions.

- [ ] **Step 6: Typecheck and lint**

Run: `cd backend && npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add backend/src/providers/retell/templates/apartment-routing.template.ts backend/src/__tests__/vertical-templates.test.ts
git commit -m "feat(templates): rent/fee guardrails and flag-gated apartment offerings"
```

---

### Task 5: Industry resolution

**Files:**
- Modify: `backend/src/providers/retell/templates/index.ts:41-57`
- Test: `backend/src/__tests__/vertical-templates.test.ts:334-356`

**Interfaces:**
- Consumes: `apartmentRoutingTemplate` registered in Task 1.
- Produces: `resolveVertical('real_estate') === 'apartment_routing'`.

- [ ] **Step 1: Verify no live client would change template**

Run: `supabase db query --linked "select slug, industry from clients where industry = 'real_estate'"`

If the CLI is unavailable, fall back to confirming no seeded client uses it: `grep -rl "real_estate" supabase/`.

**Gate:** if any live client has `industry = 'real_estate'`, STOP. Skip Steps 2–4, leave `resolveVertical` untouched, and note in the commit that the demo client is provisioned with the explicit `--template=apartment_routing` override instead. Do not silently change what an existing client's agent would become.

- [ ] **Step 2: Write the failing test**

In the `vertical resolution from industry` describe block, add to the first test:

```typescript
    expect(resolveVertical('real_estate')).toBe('apartment_routing');
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend && npx vitest run src/__tests__/vertical-templates.test.ts -t "vertical resolution"`
Expected: FAIL — received `'med_spa'`.

- [ ] **Step 4: Add the case**

In `resolveVertical`, after the `restaurant` case:

```typescript
    case 'real_estate':
      return 'apartment_routing';
```

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && npm test`
Expected: PASS, with the apartment tests added to the previous total.

- [ ] **Step 6: Commit**

```bash
git add backend/src/providers/retell/templates/index.ts backend/src/__tests__/vertical-templates.test.ts
git commit -m "feat(templates): resolve the real_estate industry to apartment_routing"
```

---

### Task 6: Harborview Apartments demo client

**Files:**
- Create: `supabase/data/011_harborview_apartments.sql`

**Interfaces:**
- Consumes: the `agent_config` flag names from Task 1 and the section semantics from Tasks 2–4.
- Produces: a client with slug `harborview-apartments` for Task 7 to provision.

- [ ] **Step 1: Write the seed file**

Model it exactly on `supabase/data/010_nonnas_table.sql`: header comment, idempotent client insert, settings insert, voice set only when null, then one `UPDATE client_settings`. Note in the header that `services` holds what can be BOOKED (tour types), while floor plans and fees live in `pricing` and `faqs` — that is what `knowledge_search` reads.

Values to use:

- Client: name `Harborview Apartments`, slug `harborview-apartments`, industry `real_estate`, timezone `America/New_York`, status `active`.
- Voice: `11labs-Adrian` when `retell_voice_id IS NULL`.
- `business_name` `Harborview Apartments`, `agent_name` `Avery`, `agent_personality` `warm, clear, and helpful`, `agent_tone` `friendly`, `agent_prompt` `''`, `booking_enabled` true, `notification_emails` `ARRAY['leasing@harborview.example']`.
- `agent_config`: `workflow_routing` true, `tours_enabled` true, `self_guided_tours` true, `online_application_url` `https://harborview.example/apply`, `resident_portal_url` `https://harborview.example/portal`, `emergency_maintenance_line` `904-555-0142`, `application_fee` 60, `admin_fee` 200, `income_requirement_multiple` 3, `pets_allowed` true.
- `services` (what can be booked): `Guided Tour` (45 min), `Self-Guided Tour` (45 min), `Virtual Tour` (30 min), `Application Appointment` (30 min) — all `price: 0`.
- `pricing` (floor plans + fees, the fake numbers):

```json
[
  {"name":"Studio — The Cove, 520 sq ft","price":1395,"unit":"month","notes":"as of today, subject to availability and change"},
  {"name":"1 Bedroom — The Marina, 715 sq ft","price":1595,"unit":"month","notes":"1 bedrooms range from about $1,595 to $1,750 depending on floor and view"},
  {"name":"2 Bedroom — The Harbor, 1,040 sq ft","price":2050,"unit":"month","notes":"2 bedrooms range from about $2,050 to $2,295"},
  {"name":"3 Bedroom — The Lighthouse, 1,310 sq ft","price":2650,"unit":"month","notes":"limited availability"},
  {"name":"Application fee","price":60,"unit":"adult applicant","notes":"non-refundable, paid with the online application"},
  {"name":"Administrative fee","price":200,"notes":"one time, due at lease signing"},
  {"name":"Pet fee","price":350,"unit":"pet","notes":"non-refundable, plus $35 per month pet rent; two pets maximum"},
  {"name":"Garage parking","price":125,"unit":"month","notes":"assigned; surface lot parking is included at no charge"},
  {"name":"Storage unit","price":45,"unit":"month","notes":"subject to availability"},
  {"name":"Month-to-month premium","price":300,"unit":"month","notes":"added to rent for a month-to-month term after the initial lease"}
]
```

- `business_policies` (12 entries, each a complete sentence): security deposit `$500 or one month's rent depending on screening`; 12-month standard lease with 6/9/18-month terms at different rates; income requirement of 3x monthly rent, verified on the application; application fee non-refundable per adult 18+; rent due on the 1st, late fee $75 after the 5th; 60-day written notice to vacate; two pets maximum with a 65 lb weight limit and restricted breeds listed on the pet addendum, **followed by a sentence stating that service and assistance animals are not pets and are not subject to pet rent, fees, breed, or weight limits**; parking (one surface space included per unit, garage extra, guest parking marked); packages held in the parcel room accessible with the resident app; smoking prohibited in units and within 25 feet of the buildings; office hours and after-hours emergency line; renewals offered 90 days before lease end.
- `faqs` (14 entries with `category`), covering: what's available and how much; what's included in rent (water/sewer/trash flat $65, electric separate); application process and timeline (2–3 business days); income and credit criteria (stated as published criteria, no promises); pets; parking; tours and self-guided tours; amenities (pool, fitness center, dog park, business center); laundry (washer/dryer in every unit); packages; lease terms; how to submit a maintenance request; what counts as an emergency and the after-hours number; utilities setup. Categories: `pricing`, `availability`, `application`, `pets`, `parking`, `tours`, `amenities`, `maintenance`, `lease`, `utilities`.

**Fair Housing check on the seed itself:** no FAQ, policy, or note may characterize the neighborhood, the schools, safety, or the residents, or describe the community as suited to any particular kind of person. Re-read every string against that before committing.

- `booking_rules`: `advance_booking_hours` 2, `max_advance_booking_days` 30, `buffer_minutes` 15, `cancellation_notice_hours` 2, `cancellation_policy` about tours, `lead_qualification_fields` `['move_in_date','bedrooms','budget']` (never a protected characteristic), `working_hours` Monday–Friday `09:00`–`18:00`, Saturday `10:00`–`17:00`, Sunday `12:00`–`17:00`.

- [ ] **Step 2: Verify the SQL parses and is idempotent**

Run it twice against the linked database:

```bash
supabase db query --linked -f supabase/data/011_harborview_apartments.sql
supabase db query --linked -f supabase/data/011_harborview_apartments.sql
```

Expected: both succeed; the second changes nothing. **Never run `supabase db push`** — it is destructive on this project.

- [ ] **Step 3: Verify the seeded client renders a clean prompt**

Run: `cd backend && npx tsx -e "import('./src/providers/retell/templates/index.js').then(async m => { const t = m.getTemplate('apartment_routing'); console.log(t ? 'registered' : 'MISSING'); })"`
Expected: `registered`.

- [ ] **Step 4: Commit**

```bash
git add supabase/data/011_harborview_apartments.sql
git commit -m "feat(data): Harborview Apartments demo client with floor plans and fee schedule"
```

---

### Task 7: Provision the demo agent to Retell

**Files:** none modified.

**Interfaces:**
- Consumes: the `harborview-apartments` client from Task 6 and the registered `apartment_routing` template.

- [ ] **Step 1: Provision**

Run: `cd backend && npm run provision -- harborview-apartments --template=apartment_routing`

- [ ] **Step 2: Record the outcome honestly**

The Retell account returned `402 Payment overdue, service stopped` on 2026-08-09. If provisioning fails with a 402, that is the expected failure and it is a billing problem, not a code problem — report it plainly with the exact error, confirm that Tasks 1–6 are unaffected, and do NOT retry in a loop or work around it. If it succeeds, record the returned `retell_agent_id` and `retell_llm_id`.

- [ ] **Step 3: Commit nothing unless provisioning wrote to the repo**

Provisioning writes to Supabase and Retell, not to the working tree. Run `git status` to confirm it is clean.

---

## Self-Review

**Spec coverage:** Fair Housing → Task 2. Maintenance emergency → Task 3. Work-order fallback intent → Task 3. Pricing perishability and no-payments → Task 4. Identity-before-account-data → Task 1 (routing-contract rule 7). Legal escalation → Task 1 (escalation section). Nine config flags → Task 1, consumed in Task 4. Intent table → Task 1. `resolveVertical` plus its risk gate → Task 5. Demo client with fake prices and fees → Task 6. Provisioning and the 402 caveat → Task 7. No gaps.

**Placeholder scan:** none. Tasks 2–4 insert their sections at the two named anchors, so every commit leaves a complete, shippable prompt and no placeholder text ever enters source. No TBDs.

**Type consistency:** `renderFees` and `renderApartmentOfferings` both take `AgentConfig` and return `string`, matching their call sites in Task 4 Step 4. Flag names in the Task 6 seed (`tours_enabled`, `self_guided_tours`, `online_application_url`, `resident_portal_url`, `emergency_maintenance_line`, `application_fee`, `admin_fee`, `income_requirement_multiple`, `pets_allowed`) match the declarations in Task 1 Step 1 exactly. `apartmentRoutingTemplate` is the export name used in Task 1 Step 4, Task 1 Step 5, and every test suite.
