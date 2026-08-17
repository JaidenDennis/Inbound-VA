import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Spec §2.5: every configure-axis write records old_value and new_value.
 *
 * The rule is enforced by `withAudit`, which reads the prior state, mutates, and
 * logs in one call — so a route cannot forget to audit, because auditing is how
 * it mutates. What that design cannot prevent on its own is a NEW route being
 * added next year that does not use the wrapper at all.
 *
 * This test is that guard. It reads the route sources, finds every mutating
 * handler behind a configure-axis grant, and fails on any that does not go
 * through `withAudit` or appear in the exemption table below with a reason.
 *
 * Source scanning rather than route-table introspection is deliberate: booting
 * Fastify tells you a handler exists, not how it audits, and the thing worth
 * catching here is a handler shaped wrongly at author time.
 */

const ROUTES_DIR = join(__dirname, '..', 'dashboard-api');

/**
 * The configure axis (spec §2.1): grants that change how the platform behaves,
 * as opposed to reading it or acting within it. `bookings:write` is an ACT grant
 * — booking an appointment is using the product, not configuring it — and is
 * deliberately absent.
 */
const CONFIGURE_GRANTS = [
  'knowledge:write',
  'agents:write',
  'crm:write',
  'configure:roles',
  'configure:alerts',
  'settings:write',
  'clients:write',
  // Migration 037. A tenant changing its own legal name, address or billing
  // contact is a configuration change like any other — the fact that it is
  // self-service does not make it less worth an audit trail.
  'account:write',
];

const MUTATING_VERBS = ['post', 'patch', 'put', 'delete'];

/**
 * Routes that hold a configure grant but change no configuration.
 *
 * Each needs a reason, and the reason has to be about what the route DOES —
 * "it was hard to wrap" is not one. Anything added here without a genuine
 * justification defeats the test it is written in.
 */
const EXEMPT: Record<string, string> = {
  'POST /admin/retry-job':
    're-enqueues an existing failed job. Changes no configuration; the job payload is already recorded in failed_jobs.',
  'POST /clients/:id/agent/sync':
    'pushes already-saved settings to Retell. The write that produced those settings was audited; this is delivery, not change.',
  'POST /ai/copilot/faqs':
    'generates draft FAQs and returns them. Writes nothing — the client edits and saves them through the audited knowledge routes.',
  'POST /ai/copilot/greeting':
    'generates a draft greeting and returns it. Writes nothing.',
  'PATCH /clients/:id/roles/:role':
    'audited inside clientPermission.setOverride, which records the prior override row and the new grant. Wrapping it again would double-log a privilege change.',
  'DELETE /clients/:id/roles/:role/:permission':
    'audited inside clientPermission.clearOverride, same reason.',
};

interface RouteBlock {
  file: string;
  verb: string;
  path: string;
  grant: string;
  source: string;
}

/**
 * Split a route file into per-handler blocks.
 *
 * Handlers are registered as top-level `app.<verb>(...)` calls at two-space
 * indentation, optionally preceded by a doc comment, which makes the boundary
 * between them unambiguous without parsing TypeScript.
 */
function routeBlocks(): RouteBlock[] {
  const blocks: RouteBlock[] = [];

  for (const file of readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.route.ts'))) {
    const source = readFileSync(join(ROUTES_DIR, file), 'utf8');

    for (const block of source.split(/\n(?=\s{2}(?:\/\*\*|app\.))/)) {
      const verb = block.match(/app\.(post|patch|put|delete)\b/)?.[1];
      if (!verb || !MUTATING_VERBS.includes(verb)) continue;

      const grant = block.match(/require(?:Permission|Platform)\('([^']+)'\)/)?.[1];
      if (!grant || !CONFIGURE_GRANTS.includes(grant)) continue;

      const path = block.match(/'(\/[^']*)'/)?.[1];
      if (!path) continue;

      blocks.push({ file, verb, path, grant, source: block });
    }
  }

  return blocks;
}

describe('configure-axis audit coverage (spec §2.5)', () => {
  const blocks = routeBlocks();

  it('finds the configure-axis routes at all', () => {
    // A scan that silently matches nothing would pass every assertion below and
    // guarantee nothing. This is the test for the test.
    expect(blocks.length).toBeGreaterThan(10);
    expect(blocks.some((b) => b.path === '/my-agent/draft/publish')).toBe(true);
  });

  it('routes every configure-axis mutation through withAudit', () => {
    const unaudited = blocks
      .filter((b) => !b.source.includes('withAudit'))
      .map((b) => `${b.verb.toUpperCase()} ${b.path}`)
      .filter((key) => !(key in EXEMPT));

    expect(
      unaudited,
      `These routes mutate behind a configure-axis grant without withAudit. Wrap them, ` +
        `or add an entry to EXEMPT in this file explaining why the route changes no configuration.`
    ).toEqual([]);
  });

  it('keeps the exemption list honest', () => {
    const live = new Set(blocks.map((b) => `${b.verb.toUpperCase()} ${b.path}`));

    // An exemption for a route that no longer exists is a stale excuse that will
    // silently cover a future route registered at the same path.
    const stale = Object.keys(EXEMPT).filter((key) => !live.has(key));
    expect(stale, 'EXEMPT names routes that no longer exist').toEqual([]);

    for (const [route, reason] of Object.entries(EXEMPT)) {
      expect(reason.length, `${route} needs a real reason`).toBeGreaterThan(40);
    }
  });

  it('populates both sides of the change, not just the new value', () => {
    // `withAudit` takes `before` and `mutate`; a handler passing a `before` that
    // returns null unconditionally is auditing in form only. Creates are the
    // legitimate case — nothing existed — so they are allowed to say so, but
    // updates are not.
    const offenders = blocks
      .filter((b) => b.source.includes('withAudit'))
      .filter((b) => ['patch', 'put'].includes(b.verb))
      .filter((b) => /before:\s*(?:async\s*)?\(\)\s*=>\s*null/.test(b.source))
      .map((b) => `${b.verb.toUpperCase()} ${b.path}`);

    expect(
      offenders,
      'An update that records no prior state cannot answer "what did this look like before?"'
    ).toEqual([]);
  });
});

describe('transcript access is recorded (spec §2.5)', () => {
  it('audits every route that returns transcript content', () => {
    // Transcripts audit differently — there is no before/after, the row IS the
    // access record — so they are checked separately from the configure axis.
    const readers = [
      { file: 'reports.route.ts', marker: 'call_transcripts' },
      { file: 'admin.route.ts', marker: 'getTranscript' },
      { file: 'ai.route.ts', marker: 'analyzeCall' },
    ];

    for (const { file, marker } of readers) {
      const source = readFileSync(join(ROUTES_DIR, file), 'utf8');
      expect(source, `${file} no longer reads transcripts — update this test`).toContain(marker);
      expect(
        source.includes('auditTranscriptView'),
        `${file} returns transcript content without recording who read it`
      ).toBe(true);
    }
  });

  it('does not gate transcript content on calls:read alone', () => {
    // client_viewer holds calls:read and is deliberately denied transcripts:read
    // (migration 016). /admin/calls/:id returned the transcript on calls:read,
    // which handed it to them anyway. The split must stay.
    const source = readFileSync(join(ROUTES_DIR, 'admin.route.ts'), 'utf8');
    const block = source.split(/\n(?=\s{2}(?:\/\*\*|app\.))/).find((b) => b.includes("'/admin/calls/:id'"));

    expect(block, '/admin/calls/:id not found — update this test').toBeDefined();
    expect(block).toContain("transcripts:read");
  });
});
