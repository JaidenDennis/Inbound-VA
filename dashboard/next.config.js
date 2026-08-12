/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001',
  },
  // Opt-in escape hatch, no-op unless the env var is set. Next 16's dev-server
  // lockfile lives at <distDir>/lock and is keyed by directory, not port, so
  // a second `next dev` on a different port still collides with another
  // session's dev server on this machine ("Another next dev server is
  // already running"). A private distDir lets a screenshot run coexist with
  // it. Kept for the later phase-1 tasks that also screenshot `/_tokens` and
  // are likely to hit the same collision on this machine.
  ...(process.env.TOKENS_SCREENSHOT_DIST_DIR
    ? { distDir: process.env.TOKENS_SCREENSHOT_DIST_DIR }
    : {}),
  // `src/app/_tokens/page.tsx` is a Next.js "private folder" (leading `_`),
  // which the router excludes entirely — `/_tokens` 404s no matter what's
  // in it. The phase-1 plan hard-codes that public URL in every task
  // through the Phase 1 gate, so rather than rename the folder (and break
  // every `git add src/app/_tokens/page.tsx` the plan also hard-codes),
  // this rewrites the public URL to the routable shim at
  // `src/app/tokens-sheet/page.tsx`, which re-exports the real component.
  // TODO(phase-3-cleanup): remove with src/app/_tokens and tokens-sheet
  async rewrites() {
    return [{ source: '/_tokens', destination: '/tokens-sheet' }];
  },
};

module.exports = nextConfig;
