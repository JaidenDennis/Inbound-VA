# Knowledge Base and Analytics Implementation Plan (Plan B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace free-text knowledge categories with a staff-managed per-client list, restructure policies from anonymous strings into titled entries, and turn Analytics into a platform-only cross-company roll-up.

**Architecture:** Three independent slices of the 2026-08-10 spec — W2 (categories), W3 (policies), W4 (analytics). Two additive migrations. The agent-facing contract (`client_settings.business_policies`, and the `category` field on FAQs) is preserved by re-rendering, so no Retell template changes.

**Tech Stack:** Node 22, TypeScript, Fastify 5, Supabase Postgres, Zod, Vitest, Next.js 16 + Tailwind.

## Global Constraints

- Source spec: `docs/superpowers/specs/2026-08-10-dashboard-fixes-and-features-design.md`. Predecessor: `docs/superpowers/plans/2026-08-10-ops-visibility-and-users.md` (complete, shipped).
- Migrations continue from **031**. 001–030 are applied in production — never edit an applied migration.
- Every migration ships a matching `supabase/rollbacks/<name>_rollback.sql`.
- Migrations must be idempotent (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DROP POLICY IF EXISTS`).
- Apply with `npx supabase db query --linked -f <path>`, then record:
  `INSERT INTO schema_migrations (version) VALUES ('0NN') ON CONFLICT (version) DO NOTHING;`
  The root `DATABASE_URL` password is stale (28P01), so `npm run migrate` and raw `pg` fail.
- **Apply migrations BEFORE deploying code, never after.** `systemErrorService.record()` swallows insert errors, so code running against an unmigrated DB fails silently.
- Backend checks from `backend/`: `npx vitest run`, `npx tsc --noEmit`, `npx eslint src`. Dashboard from `dashboard/`: `npx tsc --noEmit`, `npm run build`.
- Pre-existing lint errors that must NOT be touched and must NOT grow: `action-items.route.ts`, `knowledge.route.ts`, `export.service.ts` (backend, 3 errors); `dashboard/src/app/dashboard/page.tsx` (1 error, plus 34 dashboard warnings).
- Never use a bare `vi.fn()` as a Fastify `preHandler` — Fastify reads its arity as callback-style and hangs the request forever. Use `async (_req: unknown, _reply: unknown) => undefined`.
- `requireAuth` is a **factory**: write `requireAuth()`. A bare reference leaves the route unauthenticated.
- `UserService`-style services build their update patch from an explicit whitelist; a field not added to the whitelist is silently dropped. Check any service you extend.
- Baseline at plan time: **844 tests / 62 files passing.**

---

## Verified facts this plan depends on

Checked against the code, not assumed:

- **Only FAQs' `category` reaches the agent.** `knowledge.service.ts:133` maps `category` for FAQs. The `services` mapping (`:112-118`) reads name/description/duration/price only — `services.category` is stored but never consumed. W2 therefore targets FAQs.
- **`client_settings.business_policies` is read in 11 places**: 7 Retell templates (`dental-routing`, `law-firm-routing`, `med-spa`, `med-spa-routing`, `orthodontic-routing`, `restaurant-routing`, `inbound-routing`), plus `retell-functions.route.ts:671`, `agentDraft.service.ts:51`, `configDiff.service.ts:146`, `client.types.ts:121`. W3 must not break these.
- **`/analytics/overview` already supports the platform-wide view**: `analytics.route.ts:18` computes `const clientId = user.clientId ?? request.query.clientId`, and omitting it aggregates every tenant. No new SQL is needed for W4.
- **Analytics and Business are BOTH gated on `analytics:read` and BOTH appear in the client nav** (`Sidebar.tsx:55,58`) and the platform nav (`:81,83`). Making Analytics platform-only requires changing the route guard AND the client nav entry.
- **`requirePlatform(permission)`** exists and composes `requirePermission` then an `isPlatformUser` check (`auth.middleware.ts`). Usage pattern: `preHandler: requirePlatform('agents:read')`.
- **Knowledge tabs** are declared in `dashboard/src/app/dashboard/knowledge/page.tsx:26-31`; the FAQ `category` column is a plain text field at `:39`.
- **`PoliciesEditor.tsx`** (146 lines) edits `string[]` as a whole list with add/remove/reorder and a single Save.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/031_knowledge_categories.sql` | Per-client FAQ category list |
| `supabase/migrations/032_client_policies.sql` | Titled policies + backfill from `business_policies` |
| `backend/src/dashboard-api/knowledge.route.ts` | Category CRUD, FAQ category validation, policies CRUD |
| `backend/src/services/policyRender.service.ts` | Renders `client_policies` → `client_settings.business_policies` |
| `dashboard/src/app/dashboard/knowledge/components/CategoryEditor.tsx` | Staff-only category list editor |
| `dashboard/src/app/dashboard/knowledge/components/PoliciesEditor.tsx` | Title + body entries |
| `dashboard/src/app/dashboard/knowledge/page.tsx` | FAQ category becomes a `<select>` |
| `dashboard/src/app/dashboard/analytics/page.tsx` | Cross-company roll-up + company picker |
| `backend/src/dashboard-api/analytics.route.ts` | Platform-only guard |
| `dashboard/src/components/Sidebar.tsx` | Analytics hidden from the client nav |

---

### Task 1: `knowledge_categories` table and staff-only CRUD

**Files:**
- Create: `supabase/migrations/031_knowledge_categories.sql`, `supabase/rollbacks/031_knowledge_categories_rollback.sql`
- Modify: `backend/src/dashboard-api/knowledge.route.ts`
- Test: `backend/src/__tests__/knowledge-categories.test.ts` (create)

**Interfaces:**
- Consumes: `requirePermission`, `requirePlatform`, `assertClientAccess` from `../middleware/index.js`; `supabase` from `../db/index.js`.
- Produces:
  - table `knowledge_categories(id, client_id, name, sort_order, active, created_at, updated_at)`, unique `(client_id, name)`
  - `GET /knowledge/categories?clientId=` — any user with `knowledge:read`, scoped to their tenant
  - `POST /knowledge/categories` — **platform only**
  - `PATCH /knowledge/categories/:id` — **platform only**
  - `DELETE /knowledge/categories/:id` — **platform only**, soft delete (`active = false`)

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================
-- GRAVVIA ENGAGE – per-client FAQ category list
-- Run order: 031  (NEVER edit earlier migrations)
--
-- faqs.category is free text today, so every client invents their own spelling
-- and the console offers no guidance. The list becomes data, managed by staff
-- per client, and the client picks from it.
--
-- DELIBERATELY NOT a foreign key on faqs. knowledge.service.ts:133 reads
-- `r.category` straight into the agent prompt payload and is the only consumer;
-- keeping the denormalised NAME on faqs means no FK migration against live rows
-- and no change to prompt building. The cost is rename handling, which the
-- PATCH route pays explicitly by updating matching faqs rows in the same call.
--
-- Rollback: supabase/rollbacks/031_knowledge_categories_rollback.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS knowledge_categories (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_categories_client_name
  ON knowledge_categories(client_id, name);

CREATE INDEX IF NOT EXISTS idx_knowledge_categories_client
  ON knowledge_categories(client_id);

DROP TRIGGER IF EXISTS trg_knowledge_categories_updated_at ON knowledge_categories;
CREATE TRIGGER trg_knowledge_categories_updated_at
  BEFORE UPDATE ON knowledge_categories FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE knowledge_categories ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Write the rollback**

```sql
-- Rollback for 031_knowledge_categories.sql
--
-- faqs.category is plain text and is NOT dropped — existing FAQ rows keep
-- whatever category name they carry, so no knowledge is lost by rolling back.
DROP TABLE IF EXISTS knowledge_categories;
```

- [ ] **Step 3: Apply and record**

```bash
npx supabase db query --linked -f supabase/migrations/031_knowledge_categories.sql
npx supabase db query --linked "INSERT INTO schema_migrations (version) VALUES ('031') ON CONFLICT (version) DO NOTHING;"
```

Expected: both return `"rows": []`.

- [ ] **Step 4: Verify the table exists**

```bash
npx supabase db query --linked "SELECT column_name FROM information_schema.columns WHERE table_name='knowledge_categories' ORDER BY ordinal_position;"
```

Expected: id, client_id, name, sort_order, active, created_at, updated_at.

- [ ] **Step 5: Write the failing test**

Create `backend/src/__tests__/knowledge-categories.test.ts`. Model the Supabase mock on the existing `backend/src/__tests__/knowledge.test.ts` conventions — read that file first and follow its shape rather than inventing a new one.

The tests must cover:
1. `GET /knowledge/categories` returns the calling tenant's active categories, ordered by `sort_order`.
2. A client-scoped user calling `POST /knowledge/categories` gets **403** (platform only).
3. A platform user can create one.
4. A client-scoped user cannot read another tenant's categories (403).
5. Creating a duplicate name for the same client returns **409**, not 500.

Each test must fail if its guard is removed.

- [ ] **Step 6: Run and confirm failure**

Run: `cd backend && npx vitest run src/__tests__/knowledge-categories.test.ts`
Expected: FAIL — the routes do not exist (404).

- [ ] **Step 7a: Import `requirePlatform` (REQUIRED — it is not imported today)**

`backend/src/dashboard-api/knowledge.route.ts:4` currently reads:

```typescript
import { requirePermission, assertClientAccess } from '../middleware/index.js';
```

Change it to:

```typescript
import { requirePermission, requirePlatform, assertClientAccess } from '../middleware/index.js';
```

Without this the code below fails to compile with "Cannot find name 'requirePlatform'".

- [ ] **Step 7b: Implement the routes**

Add to `knowledge.route.ts`, inside `knowledgeRoutes`, after the existing resource loop. Reuse the file's existing `scopeFor(user, requested)` helper for tenant scoping. `z`, `supabase`, `writeAuditLog` and the local `afterWrite` are already in scope in this file.

```typescript
  /**
   * FAQ categories.
   *
   * Reading is tenant-scoped and open to anyone with knowledge:read, because the
   * FAQ form needs the list to populate its dropdown. Writing is platform-only:
   * the point of the change is that clients pick from a curated list rather than
   * inventing one, so a client who could edit the list would be back where they
   * started.
   */
  const categorySchema = z.object({
    name: z.string().min(1).max(100),
    sort_order: z.number().int().min(0).max(9999).optional(),
    active: z.boolean().optional(),
  });

  app.get<{ Querystring: { clientId?: string; includeInactive?: string } }>('/knowledge/categories', {
    preHandler: requirePermission('knowledge:read'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = scopeFor(user, request.query.clientId);
      if (!clientId) return reply.code(403).send({ error: 'Forbidden' });

      let query = supabase
        .from('knowledge_categories')
        .select('*')
        .eq('client_id', clientId)
        .order('sort_order')
        .order('name');
      if (request.query.includeInactive !== 'true') query = query.eq('active', true);

      const { data, error } = await query;
      if (error) return reply.code(500).send({ error: error.message });
      reply.send({ data: data ?? [] });
    },
  });

  app.post<{ Querystring: { clientId?: string } }>('/knowledge/categories', {
    preHandler: requirePlatform('knowledge:write'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const clientId = scopeFor(user, request.query.clientId);
      if (!clientId) return reply.code(403).send({ error: 'Forbidden' });

      const body = categorySchema.parse(request.body);
      const { data, error } = await supabase
        .from('knowledge_categories')
        .insert({ ...body, client_id: clientId })
        .select()
        .single();
      // 23505 is the (client_id, name) unique index. Answer the question the
      // caller asked rather than leaking a constraint name as a 500.
      if (error?.code === '23505') {
        return reply.code(409).send({ error: 'That category already exists for this client' });
      }
      if (error) return reply.code(400).send({ error: error.message });

      await writeAuditLog({
        userId: user.sub, clientId, action: 'knowledge.category.created',
        entityType: 'knowledge_category', entityId: (data as { id: string }).id,
        newValue: data as Record<string, unknown>, ipAddress: request.ip,
      });
      await afterWrite(clientId, user.sub);
      reply.code(201).send(data);
    },
  });
```

- [ ] **Step 8: Run the test**

Run: `cd backend && npx vitest run src/__tests__/knowledge-categories.test.ts`
Expected: PASS.

- [ ] **Step 9: Full suite + typecheck + lint**

Run: `cd backend && npx vitest run && npx tsc --noEmit && npx eslint src`
Expected: green; only the 3 pre-existing lint errors.

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/031_knowledge_categories.sql supabase/rollbacks/031_knowledge_categories_rollback.sql backend/src/dashboard-api/knowledge.route.ts backend/src/__tests__/knowledge-categories.test.ts
git commit -m "feat(knowledge): per-client FAQ category list, staff-managed"
```

---

### Task 2: Category rename cascade and FAQ validation

**Files:**
- Modify: `backend/src/dashboard-api/knowledge.route.ts`
- Test: `backend/src/__tests__/knowledge-categories.test.ts` (extend)

**Interfaces:**
- Consumes: the routes from Task 1.
- Produces: `PATCH /knowledge/categories/:id` (platform only, cascades a rename); `DELETE /knowledge/categories/:id` (platform only, soft delete); FAQ create/update reject a category not on the client's active list.

**Why the cascade is explicit:** `faqs.category` stores the NAME, not a foreign key (see the migration header). That choice avoids an FK migration and keeps prompt building untouched, but it means a rename must update the FAQ rows or every FAQ silently falls off the list.

- [ ] **Step 1: Write the failing tests**

Extend `knowledge-categories.test.ts`:
1. Renaming a category updates every `faqs` row for that client whose `category` equalled the old name — and does NOT touch other clients' rows.
2. Deleting a category is a soft delete (`active=false`); FAQ rows keep their text.
3. Creating a FAQ with a category not on the client's active list returns **400**.
4. Creating a FAQ with `category: null` succeeds (uncategorised is allowed).
5. Creating a FAQ with a valid category succeeds.

- [ ] **Step 2: Run and confirm failure**

Run: `cd backend && npx vitest run src/__tests__/knowledge-categories.test.ts`
Expected: FAIL — PATCH/DELETE routes missing, and FAQ validation absent.

- [ ] **Step 3: Implement PATCH with cascade**

```typescript
  app.patch<{ Params: { id: string } }>('/knowledge/categories/:id', {
    preHandler: requirePlatform('knowledge:write'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const { data: existing } = await supabase
        .from('knowledge_categories').select('*').eq('id', request.params.id).maybeSingle();
      if (!existing) return reply.code(404).send({ error: 'Not found' });

      const row = existing as { id: string; client_id: string; name: string };
      if (!assertClientAccess(user, row.client_id)) return reply.code(403).send({ error: 'Forbidden' });

      const body = categorySchema.partial().parse(request.body);

      const { data: updated, error } = await supabase
        .from('knowledge_categories')
        .update({ ...body, updated_at: new Date().toISOString() })
        .eq('id', request.params.id)
        .select()
        .single();
      if (error?.code === '23505') {
        return reply.code(409).send({ error: 'That category already exists for this client' });
      }
      if (error) return reply.code(400).send({ error: error.message });

      // faqs.category holds the NAME, so a rename must follow through or every
      // FAQ using it silently drops off the list. Scoped to this client only.
      if (body.name && body.name !== row.name) {
        const { error: cascadeError } = await supabase
          .from('faqs')
          .update({ category: body.name })
          .eq('client_id', row.client_id)
          .eq('category', row.name);
        if (cascadeError) return reply.code(500).send({ error: cascadeError.message });
      }

      await writeAuditLog({
        userId: user.sub, clientId: row.client_id, action: 'knowledge.category.updated',
        entityType: 'knowledge_category', entityId: row.id,
        oldValue: existing as Record<string, unknown>, newValue: updated as Record<string, unknown>,
        ipAddress: request.ip,
      });
      await afterWrite(row.client_id, user.sub);
      reply.send(updated);
    },
  });

  app.delete<{ Params: { id: string } }>('/knowledge/categories/:id', {
    preHandler: requirePlatform('knowledge:write'),
    handler: async (request, reply) => {
      const user = request.user as JwtPayload;
      const { data: existing } = await supabase
        .from('knowledge_categories').select('*').eq('id', request.params.id).maybeSingle();
      if (!existing) return reply.code(404).send({ error: 'Not found' });

      const row = existing as { id: string; client_id: string };
      if (!assertClientAccess(user, row.client_id)) return reply.code(403).send({ error: 'Forbidden' });

      // Soft delete. FAQ rows keep their category text, so removing a category
      // from the picker never rewrites content a client already wrote.
      const { error } = await supabase
        .from('knowledge_categories').update({ active: false }).eq('id', row.id);
      if (error) return reply.code(400).send({ error: error.message });

      await writeAuditLog({
        userId: user.sub, clientId: row.client_id, action: 'knowledge.category.deactivated',
        entityType: 'knowledge_category', entityId: row.id,
        oldValue: existing as Record<string, unknown>, ipAddress: request.ip,
      });
      await afterWrite(row.client_id, user.sub);
      reply.code(204).send();
    },
  });
```

- [ ] **Step 4: Add FAQ category validation**

Add this helper inside `knowledgeRoutes`:

```typescript
  /**
   * A FAQ category must be one the client actually has, or null.
   *
   * The dropdown already limits what the UI can send; this is the API-side half,
   * because a route that only validates in the browser does not validate.
   */
  async function assertCategoryAllowed(clientId: string, category: unknown): Promise<string | null> {
    if (category === undefined || category === null || category === '') return null;
    const { data } = await supabase
      .from('knowledge_categories')
      .select('id')
      .eq('client_id', clientId)
      .eq('name', category as string)
      .eq('active', true)
      .maybeSingle();
    return data ? null : `Unknown category: ${String(category)}`;
  }
```

Then in the generic `POST /knowledge/:name` handler, immediately after `const body = config.schema.parse(request.body);`, add:

```typescript
        if (name === 'faqs') {
          const categoryError = await assertCategoryAllowed(clientId, (body as { category?: unknown }).category);
          if (categoryError) return reply.code(400).send({ error: categoryError });
        }
```

And in the generic `PATCH /knowledge/:name/:id` handler, immediately after `const body = config.schema.partial().parse(request.body);`, add:

```typescript
        if (name === 'faqs' && 'category' in (body as Record<string, unknown>)) {
          const categoryError = await assertCategoryAllowed(rowClientId, (body as { category?: unknown }).category);
          if (categoryError) return reply.code(400).send({ error: categoryError });
        }
```

- [ ] **Step 5: Run the tests**

Run: `cd backend && npx vitest run src/__tests__/knowledge-categories.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite**

Run: `cd backend && npx vitest run && npx tsc --noEmit && npx eslint src`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add backend/src/dashboard-api/knowledge.route.ts backend/src/__tests__/knowledge-categories.test.ts
git commit -m "feat(knowledge): cascade category renames and validate FAQ categories"
```

---

### Task 3: FAQ category dropdown and staff category editor

**Files:**
- Create: `dashboard/src/app/dashboard/knowledge/components/CategoryEditor.tsx`
- Modify: `dashboard/src/app/dashboard/knowledge/page.tsx`

**Interfaces:**
- Consumes: `GET/POST/PATCH/DELETE /knowledge/categories` from Tasks 1–2.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Read the page first**

Read `dashboard/src/app/dashboard/knowledge/page.tsx` fully. The FAQ `category` column is declared at roughly line 39 as a plain field. Understand how the generic column config renders fields before changing it — the same config drives every knowledge tab, so a careless change affects services/pricing/promotions too.

- [ ] **Step 2: Add a `select` field type to the shared table**

The knowledge tabs are rendered by `InlineEditTable` (`dashboard/src/components/InlineEditTable.tsx`), whose field type is:

```typescript
export interface FieldSpec {
  key: string;
  label: string;
  type?: 'text' | 'textarea' | 'number';
  required?: boolean;
  placeholder?: string;
  /** Column width hint for the table header. */
  width?: string;
  render?: (value: unknown) => ReactNode;
}
```

Extend it — do NOT special-case `category` by name, which would break the next column that needs a dropdown:

```typescript
  type?: 'text' | 'textarea' | 'number' | 'select';
  /** Options for `type: 'select'`. An empty-string value renders as "no choice". */
  options?: Array<{ value: string; label: string }>;
```

The editor cell is chosen at `InlineEditTable.tsx:106-119` (`field.type === 'textarea' ? ... : <input type={field.type === 'number' ? 'number' : 'text'} ...>`). Add a `select` branch there that renders a `<select>` over `field.options`, keeping the same value/onChange contract the other branches use so create and update rows behave identically.

Uncategorised must stay choosable: include an option with `value: ''` labelled `— none —`. The knowledge route treats `''` as "no category" (`assertCategoryAllowed` returns null for `''`), so an empty string is safe to send.

**This is a shared component** — services, pricing and promotions all render through it. Changing the `type` union is additive, so existing columns are unaffected, but verify those three tabs still render after the change.

- [ ] **Step 3: Remove the free-text category from Services**

The Services tab's `category` field is free text and, per the verified facts above, is never read by the agent (`knowledge.service.ts` maps services without it). The user asked to be rid of free-text categories. Remove the `category` column from the SERVICES column config only. Do NOT drop the database column — existing values stay, and nothing else reads them.

- [ ] **Step 4: Build the CategoryEditor component**

Create `dashboard/src/app/dashboard/knowledge/components/CategoryEditor.tsx`, modelled on the conventions in the sibling `PoliciesEditor.tsx` (read it first — same directory, same import style, `api` from `@/lib/api`, `react-hot-toast` for feedback).

Behaviour:
- Lists the client's categories with add / rename / remove.
- Renders **only for platform users** — take an `isPlatform` prop or read `useSession()`; the API is platform-only, so showing the controls to a client would offer buttons that always 403.
- A rename warns that it will update existing FAQs using that name (it cascades server-side).
- A 409 surfaces as "that category already exists", not a generic failure.

- [ ] **Step 5: Surface the editor**

Render `CategoryEditor` on the FAQs tab for platform users only.

- [ ] **Step 6: Verify**

Run from `dashboard/`: `npx tsc --noEmit`, `npm run build`, `npx eslint .`
Expected: tsc and build clean; eslint no worse than baseline (1 pre-existing error + 34 warnings).

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/app/dashboard/knowledge/
git commit -m "feat(knowledge): FAQ category dropdown and staff category editor"
```

---

### Task 4: `client_policies` table and the `business_policies` render

**Files:**
- Create: `supabase/migrations/032_client_policies.sql`, `supabase/rollbacks/032_client_policies_rollback.sql`
- Create: `backend/src/services/policyRender.service.ts`
- Modify: `backend/src/dashboard-api/knowledge.route.ts`, `backend/src/services/index.ts`
- Test: `backend/src/__tests__/client-policies.test.ts` (create)

**Interfaces:**
- Produces:
  - table `client_policies(id, client_id, title, body, sort_order, active, created_at, updated_at)`
  - `renderPolicies(clientId): Promise<string[]>` in `policyRender.service.ts` — rebuilds `client_settings.business_policies` from the table and returns what it wrote
  - `GET /knowledge/policies` now returns `{ data: Array<{id,title,body,sort_order}> }` (SHAPE CHANGE — Task 5 updates the UI)
  - `PUT /knowledge/policies` accepts `{ policies: Array<{title, body}> }` (SHAPE CHANGE)

**The load-bearing decision:** `client_settings.business_policies` (a `TEXT[]`) stays the agent-facing contract. It is read in 11 places (listed in Verified Facts). Every write to `client_policies` re-renders that array as `"Title: Body"` strings ordered by `sort_order`. Nothing downstream changes, and the prompt gets better-structured text than today's anonymous strings.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================
-- GRAVVIA ENGAGE – policies as titled entries
-- Run order: 032  (NEVER edit earlier migrations)
--
-- client_settings.business_policies is a bare TEXT[] of anonymous strings, rendered in
-- the console as one broad text box that operators find hard to fill in well.
-- Policies become rows with a title and a body.
--
-- client_settings.business_policies IS DELIBERATELY KEPT and stays the agent-facing
-- contract. It is read by seven Retell templates plus retell-functions.route.ts,
-- agentDraft.service.ts, configDiff.service.ts and client.types.ts. Migrating
-- all of those to a relational read is a large blast radius for no user-visible
-- gain, so every write to client_policies re-renders that array instead.
--
-- Backfill gives each existing string its own row, body = the string, title =
-- "Policy N" for the operator to rename. Nothing is lost and nothing is guessed.
--
-- Rollback: supabase/rollbacks/032_client_policies_rollback.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS client_policies (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_policies_client ON client_policies(client_id);

DROP TRIGGER IF EXISTS trg_client_policies_updated_at ON client_policies;
CREATE TRIGGER trg_client_policies_updated_at
  BEFORE UPDATE ON client_policies FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE client_policies ENABLE ROW LEVEL SECURITY;

-- Backfill. Guarded so re-running the migration cannot duplicate rows.
INSERT INTO client_policies (client_id, title, body, sort_order)
SELECT c.id,
       'Policy ' || p.ord::text,
       p.policy,
       p.ord - 1
FROM client_settings cs
CROSS JOIN LATERAL unnest(c.business_policies) WITH ORDINALITY AS p(policy, ord)
WHERE COALESCE(array_length(c.business_policies, 1), 0) > 0
  AND NOT EXISTS (SELECT 1 FROM client_policies cp WHERE cp.client_id = c.id);
```

- [ ] **Step 2: Write the rollback**

```sql
-- Rollback for 032_client_policies.sql
--
-- client_settings.business_policies was never dropped and has been kept in sync by
-- renderPolicies() on every write, so dropping this table loses no policy text.
DROP TABLE IF EXISTS client_policies;
```

- [ ] **Step 3: Apply and record**

```bash
npx supabase db query --linked -f supabase/migrations/032_client_policies.sql
npx supabase db query --linked "INSERT INTO schema_migrations (version) VALUES ('032') ON CONFLICT (version) DO NOTHING;"
```

- [ ] **Step 4: Verify the backfill**

```bash
npx supabase db query --linked "SELECT c.name, array_length(c.business_policies,1) AS old_count, (SELECT count(*) FROM client_policies cp WHERE cp.client_id=c.id) AS new_count FROM clients c WHERE COALESCE(array_length(c.business_policies,1),0) > 0;"
```

Expected: `old_count` equals `new_count` for every row. Report the actual table.

- [ ] **Step 5: Write the failing test**

Create `backend/src/__tests__/client-policies.test.ts`. The critical assertion is the **exact rendered string**, because that array is the agent's input:

- `renderPolicies` produces `"Title: Body"` per active policy, ordered by `sort_order`.
- Inactive policies are excluded.
- A policy with an empty body renders as just the title (no trailing `": "`).
- The rendered array is written to `client_settings.business_policies`.
- Ordering is by `sort_order`, not insertion order.

- [ ] **Step 6: Run and confirm failure**

Run: `cd backend && npx vitest run src/__tests__/client-policies.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement the renderer**

Create `backend/src/services/policyRender.service.ts`:

```typescript
import { supabase } from '../db/index.js';

/**
 * Rebuild `client_settings.business_policies` from `client_policies`.
 *
 * That TEXT[] is the agent-facing contract: seven Retell templates and four
 * other call sites read it, so it stays authoritative and this function keeps
 * it true after every edit. The rendered form is "Title: Body", which gives the
 * prompt more structure than the anonymous strings it used to receive.
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
    .from('clients')
    .update({ business_policies: rendered })
    .eq('id', clientId);
  if (writeError) throw new Error(writeError.message);

  return rendered;
}
```

Export it from `backend/src/services/index.ts` alongside the other service exports.

- [ ] **Step 8: Replace the policies routes**

In `knowledge.route.ts`, replace the existing `GET /knowledge/policies` and `PUT /knowledge/policies` handlers (they currently read and write `client_settings.business_policies` directly) with handlers over `client_policies`:

- `GET` returns `{ data: Array<{ id, title, body, sort_order }> }` for active policies ordered by `sort_order`.
- `PUT` accepts `z.object({ policies: z.array(z.object({ title: z.string().min(1).max(200), body: z.string().max(4000).default('') })).max(50) })`, replaces the client's set (soft-delete the old rows or delete and re-insert — either is fine, but the whole set must end up matching the payload exactly, with `sort_order` following array order), then calls `renderPolicies(clientId)` and `afterWrite(clientId, user.sub)`.
- Keep the existing `withAudit`/`writeAuditLog` behaviour so a policy change stays auditable.

- [ ] **Step 9: Run tests**

Run: `cd backend && npx vitest run && npx tsc --noEmit && npx eslint src`
Expected: green. If an existing test asserted the OLD `string[]` shape of `/knowledge/policies`, update that test to the new shape — but do not weaken what it checks.

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/032_client_policies.sql supabase/rollbacks/032_client_policies_rollback.sql backend/src/services/policyRender.service.ts backend/src/services/index.ts backend/src/dashboard-api/knowledge.route.ts backend/src/__tests__/client-policies.test.ts
git commit -m "feat(knowledge): policies become titled entries, rendered into business_policies"
```

---

### Task 5: Policies editor UI

**Files:**
- Modify: `dashboard/src/app/dashboard/knowledge/components/PoliciesEditor.tsx`

**Interfaces:**
- Consumes: the new `GET`/`PUT /knowledge/policies` shapes from Task 4.

- [ ] **Step 1: Read the current editor**

Read `PoliciesEditor.tsx` (146 lines) fully. It currently holds `string[]`, with add/remove/reorder and a single Save, and a `dirty` flag. Keep all of that behaviour — only the shape of an entry changes.

- [ ] **Step 2: Convert to title + body**

State becomes `Array<{ title: string; body: string }>`. Each row renders a short title input and a larger body textarea. Preserve: add, remove, reorder (`move`), the `dirty` flag, the single Save button, the `readOnly` prop, and the loading state.

Save sends `{ policies: [{title, body}, ...] }` in array order — the server derives `sort_order` from that order.

- [ ] **Step 3: Guard empty titles**

A row with a blank title cannot be saved (the API requires `title` min length 1). Either block Save with a clear inline message or filter blank rows out before sending — but do not send a blank title and let the request 400 with a generic error.

- [ ] **Step 4: Verify**

Run from `dashboard/`: `npx tsc --noEmit`, `npm run build`, `npx eslint .`
Expected: clean; eslint no worse than baseline.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/app/dashboard/knowledge/components/PoliciesEditor.tsx
git commit -m "feat(knowledge): policies editor takes titled entries"
```

---

### Task 6: Analytics as a platform-only cross-company roll-up

**Files:**
- Modify: `backend/src/dashboard-api/analytics.route.ts`, `dashboard/src/app/dashboard/analytics/page.tsx`, `dashboard/src/components/Sidebar.tsx`
- Test: `backend/src/__tests__/analytics-scope.test.ts` (create)

**Interfaces:**
- Consumes: `requirePlatform` from `../middleware/index.js`; the existing `/analytics/overview` handler, which already aggregates every tenant when no `clientId` is given (`analytics.route.ts:18`).
- Produces: `/analytics/overview` becomes platform-only.

**Scope note:** the Business tab is NOT touched. Its Money/Trust/Demand/Follow-through clusters stay exactly where they are — this was explicitly confirmed with the user.

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/analytics-scope.test.ts`:
1. A platform user gets 200 from `/analytics/overview` with no `clientId` (the all-companies view).
2. A platform user gets 200 with a `clientId` and the handler filters to it.
3. A **client-scoped** user gets **403**.

Test 3 must fail if the guard is reverted to `requirePermission`.

- [ ] **Step 2: Run and confirm failure**

Run: `cd backend && npx vitest run src/__tests__/analytics-scope.test.ts`
Expected: FAIL on test 3 — a client user currently gets 200.

- [ ] **Step 3: Gate the route**

In `analytics.route.ts`, change the import to bring in `requirePlatform` and change the preHandler:

```typescript
      preHandler: requirePlatform('analytics:read'),
```

Add a short comment saying why: this view aggregates across every tenant, so it is staff-only; a client's own numbers live on the Business tab.

Since only platform users reach the handler now, `user.clientId` is always null there, so `const clientId = user.clientId ?? request.query.clientId` reduces to the query parameter. Leave that expression as it is — it stays correct and defends the tenant scoping if the guard is ever loosened.

- [ ] **Step 4: Hide Analytics from the client nav**

In `dashboard/src/components/Sidebar.tsx`, remove the Analytics entry from the CLIENT nav list (around line 55). Leave the platform nav's Analytics entry, and leave BOTH Business entries alone.

- [ ] **Step 5: Add the company picker**

In `dashboard/src/app/dashboard/analytics/page.tsx`, add a company selector above the figures: an "All companies" option plus one per client, driven by `GET /clients`. Selecting a company passes `clientId` to `/analytics/overview`; "All companies" omits it.

**Do NOT reuse `useClientScope()` / `ChooseClientPrompt` here, and do not modify them.** Their semantics are the opposite of what this page needs. `useClientScope()` (`dashboard/src/components/ClientPicker.tsx:29-41`) returns `needsChoice: !requested` for platform users — "no client selected" is an error state that pages resolve by rendering `ChooseClientPrompt`. On Analytics, no selection is the *primary* view: all companies. Bending the shared hook to mean both things would break every other page that relies on it.

Write a plain `<select>` in this page instead, matching `ClientPicker`'s visual treatment so the two look consistent. Populate it from `GET /clients`. Value `''` means All companies and omits `clientId` from the request; any other value passes that `clientId` through.

Keep the existing chart and stat tiles. Label the page so it is obvious the numbers are cross-company when "All companies" is selected.

- [ ] **Step 6: Verify**

Run: `cd backend && npx vitest run && npx tsc --noEmit && npx eslint src`; from `dashboard/`: `npx tsc --noEmit && npm run build && npx eslint .`
Expected: all green; lint no worse than baseline.

- [ ] **Step 7: Commit**

```bash
git add backend/src/dashboard-api/analytics.route.ts backend/src/__tests__/analytics-scope.test.ts dashboard/src/app/dashboard/analytics/page.tsx dashboard/src/components/Sidebar.tsx
git commit -m "feat(analytics): platform-only cross-company roll-up with a company picker"
```

---

## Verification

- [ ] `cd backend && npx vitest run` → all passing, no regressions from the 844 baseline
- [ ] `cd backend && npx tsc --noEmit` → exit 0
- [ ] `cd backend && npx eslint src` → only the 3 pre-existing errors
- [ ] `cd dashboard && npx tsc --noEmit && npm run build` → exit 0
- [ ] `npx supabase db query --linked "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 3;"` → `032`, `031`, `030`
- [ ] Backfill check from Task 4 Step 4 shows `old_count = new_count` for every client with policies

## Known consequences to expect

- **`/knowledge/policies` changes shape** between Task 4 and Task 5. The Policies tab is broken in between — that is why they are adjacent, and why both must land before deploy.
- **Clients lose the Analytics nav item.** Intended: their numbers are on Business.
- **Existing FAQ categories become unvalidated legacy text.** Rows keep whatever they hold; only NEW writes are checked against the list. A client with existing free-text categories will see them in the table but not in the dropdown until staff add matching entries. This is deliberate — silently rewriting a client's content would be worse.
