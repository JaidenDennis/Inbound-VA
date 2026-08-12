/**
 * Design guards — the stand-in for tests in a workspace that has none.
 *
 * Four ways the cobalt world silently rots, each caught here:
 *   1. a stray hex outside the token layer, which cannot follow the theme
 *   2. a `rounded-*` that resurrects a corner radius
 *   3. `bg-white`, a Tailwind default that is not a token and stays light
 *   4. a leftover teal from the retired `signal` ramp
 *
 * Run: npm run guards
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/** The token layer is the ONE place raw hex is allowed to live. */
const HEX_HOME = join('app', 'globals.css');

/**
 * Client-configurable brand colour. The hex here is DATA — a colour
 * input's default and its placeholder — not a design token, so it is
 * exempt by design rather than by oversight.
 */
const HEX_ALLOWED = [join('app', 'dashboard', 'clients', '[id]', 'BrandingPanel.tsx')];

/** Radius survives only on genuinely circular things: lamps and dots. */
const ROUND_ALLOWED = /rounded-full/;

const RULES = [
  {
    name: 'hex outside the token layer',
    re: /#[0-9A-Fa-f]{3,8}\b/g,
    skip: (rel) => rel.endsWith(HEX_HOME) || HEX_ALLOWED.some((a) => rel.endsWith(a)),
    hint: 'Move the value into the :root / [data-theme="dark"] blocks of globals.css and reference it.',
  },
  {
    name: 'corner radius',
    re: /\brounded(-[a-z0-9]+)?\b/g,
    skip: (rel) => rel.endsWith(HEX_HOME),
    ok: (m) => ROUND_ALLOWED.test(m),
    hint: 'Corners are 0 in this world. Only lamps and dots keep rounded-full.',
  },
  {
    name: 'bg-white',
    re: /\bbg-white\b/g,
    hint: 'white is a Tailwind default, not a token, and will not follow the theme. Use bg-surface-raised.',
  },
  {
    name: 'retired teal',
    re: /#(1E7A90|0B6E7F|095868|0A4553|0A3844|3D93A8|6FB6C7|A9D6E0|D6EBF0|EFF7F9)\b/gi,
    skip: (rel) => rel.endsWith(HEX_HOME),
    hint: 'The teal signal ramp is retired. Cobalt took its role.',
  },
];

function* walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(tsx?|css)$/.test(e)) yield p;
  }
}

let violations = 0;
for (const file of walk(SRC)) {
  const rel = relative(SRC, file);
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  for (const rule of RULES) {
    if (rule.skip?.(rel)) continue;
    lines.forEach((line, i) => {
      for (const m of line.matchAll(rule.re)) {
        if (rule.ok?.(m[0])) continue;
        console.error(`  src${sep}${rel}:${i + 1}  ${rule.name}: ${m[0]}`);
        console.error(`      ${rule.hint}`);
        violations++;
      }
    });
  }
}

if (violations) {
  console.error(`\n design-guards: ${violations} violation(s)\n`);
  process.exit(1);
}
console.log('design-guards: clean');
