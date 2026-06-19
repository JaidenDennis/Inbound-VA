# Security TODO — outstanding `npm audit` findings

Last reviewed: 2026-06-19. `npm audit` reports **16 vulnerabilities (3 critical,
7 high, 6 moderate)**. Every available fix is a **major breaking upgrade**
(`npm audit fix` with no `--force` applies nothing). They are grouped below by
root cause, with what each upgrade requires and a recommendation.

> ⚠️ Do **not** run `npm audit fix --force`. It would jump Fastify 4→5,
> Next 14→16, vitest 2→4 simultaneously and break the build with no testing.

---

## 1. `fast-jwt` (CRITICAL) + `fast-uri` (HIGH) — via Fastify 4

**Packages:** `fast-jwt` (≤6.2.3) under `@fastify/jwt@8`; `fast-uri` (≤3.1.1)
under `fastify@4` internals (`fast-json-stringify`, `@fastify/ajv-compiler`).

**Why it can't be patched in isolation:** the patched `fast-jwt@6.2.4` is only
consumed by `@fastify/jwt@10`, which requires **Fastify 5**. There is no patched
`fast-jwt` in the `4.x` line that our `@fastify/jwt@8` supports. An npm
`override` forcing `fast-jwt@6.2.4` under `@fastify/jwt@8` was tested and npm
refuses it (two-major gap), and the combination is unsupported upstream anyway.
`fast-uri` is likewise fixed by the Fastify 5 line. **So both are remediated by
one change: the Fastify 4→5 upgrade.**

### Actual exposure analysis (important)
We reviewed all six `fast-jwt` advisories against how this codebase uses JWT
(`backend/src/app.ts`, `backend/src/middleware/auth.middleware.ts`,
`backend/src/dashboard-api/auth.route.ts`). We sign/verify with **HS256 using a
static, non-empty secret** (`env.JWT_SECRET`, Zod-validated to ≥32 chars):

| Advisory | Applies to us? |
|---|---|
| Algorithm confusion via whitespace-prefixed **RSA** public key | **No** — we use HS256 symmetric, no RSA keys |
| Auth bypass via **empty HMAC secret in async key resolver** | **No** — static non-empty secret, no async resolver |
| Improper **`iss`** claim validation | **No** — we don't set or validate `iss` |
| Cache confusion via **`cacheKeyBuilder`** | **No** — caching not enabled |
| Stateful RegExp DoS in **allowed-claim** validation | **No** — no `allowedIss/Aud/Sub` regexes |
| Accepts unknown **`crit`** header extensions | Minimal — RFC strictness only, no auth impact for our flow |

**Conclusion:** our real-world exposure to these CVEs is effectively nil given
the HS256 + static-secret configuration. The critical rating reflects the
package, not our usage.

### What the upgrade requires (Fastify 4 → 5)
- Bump core: `fastify@^5`, and all first-party plugins to their v5 lines:
  `@fastify/jwt@^10`, `@fastify/cors@^11`, `@fastify/helmet@^13`,
  `@fastify/rate-limit@^10`, `@fastify/swagger@^9`.
- Code review for Fastify 5 breaking changes (mostly minor for us):
  `addContentTypeParser` (rawBody capture — API unchanged in v5), the custom
  `setErrorHandler`, and the `declare module 'fastify'` type augmentation.
- Re-verify: `npm run build`, the full test suite, and a runtime JWT
  sign/verify + a webhook signature round-trip.

### Recommendation
**Plan a dedicated Fastify 5 PR** (not bundled with the deploy). Given near-nil
actual exposure, this is **medium priority** — do it deliberately and tested,
not under deploy pressure. It clears the critical (`fast-jwt`) **and** the high
(`fast-uri`) findings in one change.

---

## 2. `next` (CRITICAL ×, multiple) — dashboard only

**Package:** `next@14.2.15` — many advisories (SSRF via middleware redirects,
cache poisoning, image-optimizer DoS, middleware authorization bypass, etc.).
Fix requires **Next 14 → 16** (breaking).

**Scope:** affects **`@gravvia/dashboard` only** — it is **not** part of the
backend service being deployed now, and the dashboard is deployed separately
later. The backend (`@gravvia/backend`) does not depend on Next.

### What the upgrade requires
- `next@^16` + matching `eslint-config-next`; React stays 18-compatible but
  verify. Review App Router behavior, `middleware.ts` (we use it for the auth
  route guard), and `next.config.js`.
- Several advisories only affect specific features (image optimizer
  `remotePatterns`, Server Actions). Audit which we actually use.
- Re-run `npm run build --workspace=@gravvia/dashboard` and manually smoke-test
  login + dashboard pages.

### Recommendation
**High priority before the dashboard goes live**, but it does **not block the
backend deploy**. Do it as part of dashboard deployment prep. Until then, the
dashboard should not be exposed publicly.

---

## 3. `esbuild` / `vite` / `vitest` (MODERATE) — dev tooling only

**Packages:** `esbuild@≤0.24.2` → `vite` → `@vitest/mocker` → `vitest@2`.
Advisory: esbuild dev-server can be requested cross-origin (dev only). Fix
requires **vitest 2 → 4** (breaking).

**Scope:** **devDependencies only.** `esbuild`/`vite`/`vitest` are not installed
in production images (the Render build runs `tsc`, not vite) and never run in
the deployed service. The advisory concerns the local dev server.

### Recommendation
**Low priority.** No production exposure. Upgrade to `vitest@4` opportunistically
when convenient and re-run the test suite (a few config/API changes expected).

---

## Summary table

| Group | Severity | Affects prod backend? | Fix | Priority |
|---|---|---|---|---|
| `fast-jwt` / `fast-uri` (Fastify 4) | Critical / High | Yes (but exposure ~nil, see analysis) | Fastify 4→5 + plugin bumps | Medium |
| `next` | Critical | No (dashboard only) | Next 14→16 | High before dashboard launch |
| `esbuild`/`vite`/`vitest` | Moderate | No (dev only) | vitest 2→4 | Low |

**Net:** nothing here is safely auto-fixable, and the one production-facing
group (`fast-jwt`) does not match our actual usage. No emergency action; schedule
the Fastify 5 upgrade as a tested PR.
