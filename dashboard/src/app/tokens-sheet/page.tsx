/**
 * Routing shim — do not put real content here.
 *
 * Next.js App Router treats any folder prefixed with `_` as a "private
 * folder" and excludes it from the route table entirely (documented
 * behaviour, not a bug: https://nextjs.org/docs/app/getting-started/project-structure#private-folders).
 * That means `src/app/_tokens/page.tsx` — the path the phase-1 plan
 * names in every task from here through the Phase 1 gate — can never
 * be reached directly; requesting `/_tokens` 404s no matter what it
 * contains.
 *
 * The plan also hard-codes the PUBLIC URL `/_tokens` in screenshot
 * commands across Task 3, Task 4 Step 5, and Task 12 Step 4. Renaming
 * the folder would satisfy the router but break every one of those
 * commands and the `git add src/app/_tokens/page.tsx` lines that go
 * with them.
 *
 * This keeps both promises: the real token-sheet component still lives
 * at `src/app/_tokens/page.tsx` (imported below) so every future task's
 * file path and git-add instructions are correct unmodified, and the
 * rewrite in next.config.js maps the public `/_tokens` URL to this
 * routable, non-private path that actually serves it.
 */
export { default } from '../_tokens/page';
