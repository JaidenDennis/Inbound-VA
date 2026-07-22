# Inbound Build — Phase 2 Verification Report (Knowledge)

Date: 2026-07-21 · Tests: **30 files / 191 passing** (`npx vitest run`; `npx tsc --noEmit` clean). Prior: 29/180 (Phase 1).

## What was built

**Schema (additive)** — `supabase/migrations/012_knowledge_tables.sql`: `services` (unique per client name, duration/price/category/active), `pricing` (optional `service_id` link, `member_price`, `upsell_note`), `faqs`, `promotions` (eligibility + `starts_at`/`ends_at` window). All client_id-keyed with the standard trigger/RLS conventions. **The locked `client_settings` JSONB columns are untouched** — the backend reads relational-first with JSONB fallback (audit conflict #8), so existing clients need no data migration.

**Knowledge service** — `src/services/knowledge.service.ts`:
- `load(clientId, settings?)` — relational rows first, `client_settings` fallback per section; promotion date windows enforced in the backend (expired/future offers can never reach the agent).
- `settingsWithKnowledge` — non-mutating overlay used by provisioning (agent prompts now render from the live knowledge base) and by `update_workflow` slot validation (rules like "service exists for this client" check the live menu).
- `search(clientId, query)` — fully deterministic token/phrase scoring across faqs/services/pricing/promotions (no LLM), top-3 per section, plus `activePromotions` (all live offers regardless of query).

**Action & tool** — `knowledge_search` endpoint in the function routes (`scope: knowledge`, idempotent/retry-safe metadata, scope-guarded); promotions topic returns every live offer; misses answer with explicit "never guess" guidance.

**Workflows (declarative)** — `faq` (hours/location/parking/insurance/payment/gift-cards/policies intents), `pricing` (required `service` slot validated against the client's live menu; member/upsell surfacing rules), `promotions` (windows enforced server-side), `general_information` (fallback). All grant `knowledge + support` scopes — booking tools stay denied during knowledge topics, proving capability isolation.

**Wiring** — definitions registered; `RETELL_FUNCTION_NAMES` + routing-template tool spec + prompt rule ("factual questions → knowledge_search, answer only from results"); `provisioning.service` builds templates from knowledge-merged settings.

## What was verified, and how

`__tests__/knowledge.test.ts` (11 tests):
- **Relational-first + fallback**: rows win when present; `client_settings` JSONB used when a table is empty.
- **Promotion windows**: expired and not-yet-started offers excluded; open-ended and in-window included (clock-relative fixtures so the suite never rots).
- **Multi-tenant isolation** (service + endpoint level): two clients with different knowledge get different answers to the same question ("Do you accept insurance?" → "most major plans" vs "cash pay only"); tenant resolved from the dialed number.
- **Deterministic search**: natural-language FAQ match, service/pricing match with upsell note, `found:false` + "never guess" guidance on no match.
- **Intent routing**: `hours`→faq, `pricing`→pricing, `specials`→promotions, all with the knowledge scope.

Regressions fixed and re-verified: `provisioning.test` and `workflow-routing.test` now stub the knowledge overlay (identity), keeping their original assertions intact. Full suite green.

## Carried forward
- Dashboard CRUD for the new tables is deferred to the dashboard track (API routes exist pattern-wise under `dashboard-api/`); seeding relational knowledge for the live med-spa client can be done via `supabase/data` scripts when desired.
