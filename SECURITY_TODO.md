# Security status — `npm audit`

Last updated: 2026-06-20. **Resolved 16 → 2 vulnerabilities.** The 2 remaining
are moderate, build-time-only, and transitive inside Next (not directly fixable).

## ✅ Resolved

| Finding | Severity | Fix applied | Verified |
|---|---|---|---|
| `fast-jwt` (auth) | **Critical** | Fastify 4→5 + `@fastify/jwt`@10 | build, 24/24 tests, runtime JWT sign/verify round-trip, container `/health` 200 |
| `fast-uri` | High | Fastify 4→5 (internal `fast-json-stringify`/ajv-compiler) | same |
| `next` (SSRF, cache poisoning, DoS, mw auth bypass, …) | **Critical** ×17 | Next 14→16 | build (13 routes), runtime `/login` 200 + middleware guard 307 |
| `nodemailer` | High | 6→9 | build + tests |
| `uuid` (buffer bounds, v3/v5/v6) | Moderate | 10→14 (we never pass `buf`, so weren't exposed) | build + tests |
| `esbuild`/`vite`/`@vitest/mocker` | Moderate | vitest 2→4 | 24/24 tests |

### Code changes required by the upgrades
- **Fastify 5:** `backend/src/app.ts` — error-handler `error` param is now typed
  `unknown`; annotated as `FastifyError`. Plugins bumped: `@fastify/jwt`@10,
  `@fastify/cors`@11, `@fastify/helmet`@13, `@fastify/rate-limit`@11,
  `@fastify/swagger`@9. rawBody content-type parser and JWT usage unchanged
  (verified at runtime).
- **Next 16:** `dashboard/src/lib/auth.ts` — `cookies()` is now async; added
  `await`. React stays 18 (Next 16 supports it). No other changes.
- **vitest 4 / nodemailer 9 / uuid 14:** no code changes needed.

## ⚠️ Remaining (2 moderate) — accepted, tracked

**`postcss` < 8.5.10** (`GHSA-qx2v-qp2m-jg93`, XSS via unescaped `</style>` in
CSS stringify), bundled at `node_modules/next/node_modules/postcss` inside
**Next 16**.

- **Why not fixed:** Next vendors its own postcss; an npm `override` to
  `^8.5.10` does not redirect Next's nested copy, and `npm audit fix --force`
  "resolves" it by downgrading Next to 9.3.3 (nonsensical).
- **Exposure:** build-time only. postcss runs during `next build` on **our own
  trusted CSS** (Tailwind), never on attacker-controlled input, and never at
  runtime in the deployed service. The backend (deployed now) doesn't use Next.
- **Recommendation:** **Low priority — accept for now.** It clears automatically
  when Next ships a release bumping its bundled postcss; re-run `npm audit` after
  future `next` updates.

## Net
- **0 vulnerabilities affect the deployed backend at runtime.**
- 2 moderate remain in the dashboard's build toolchain (Next-internal postcss),
  with no runtime exposure.
