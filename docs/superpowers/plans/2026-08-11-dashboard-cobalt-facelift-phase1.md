# Dashboard Cobalt Facelift — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Gravvia Engage dashboard's visual language with the marketing site's bone/ink/cobalt world — token layer, dark mode, all 21 shared components, and two hand-finished pilot pages — so the user can approve the direction before Phases 2–3 touch the remaining 29 routes.

**Architecture:** All colour moves to CSS custom properties defined once on `:root` and once on `[data-theme="dark"]` in `globals.css`. `tailwind.config.ts` holds only `var(--…)` references and structural scales. Legacy Tailwind colour names are preserved and repointed, so 335 `rounded-*`, 199 `signal-*`, and 294 legacy colour references convert at the config layer instead of across 69 files.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS, `clsx`, `lucide-react`, `recharts`, `next/font/google` (DM Sans, DM Mono). No test framework — see Global Constraints.

**Spec:** `docs/superpowers/specs/2026-08-11-dashboard-cobalt-facelift-design.md`

**Branch:** `feat/dashboard-cobalt-facelift` (already created off `main` @ `3bc78db`)

---

## Global Constraints

Every task's requirements implicitly include this section.

**Scope**
- `dashboard/` workspace only. **No backend changes.** No changes to `gravvia-site`.
- Do not add a test framework. Do not add runtime dependencies.

**Design values — exact, from `C:\Users\VYRA\Desktop\gravvia-site\assets\site.css`**
- bone `#f0f0ee` · ink `#030303` · cobalt `#1d4fd8` · cobalt-lt `#8aa4ff` · dark inset `#0c0c0c`
- Radius `0` on every named step except `full`. Lamps and dots stay circular.
- Shadows are **hard offsets, no blur**. Exactly two: cobalt 6px (lifted interactive cards), ink (floating layers only).
- Body weight **400**; weight 300 only at display sizes ≥25px; headings 500 at `-0.02em`.
- Mono for every micro-label: uppercase, 9–11px, `.16–.24em` tracking.

**Rules**
- **Cobalt means "you can act on this." Green/amber/red mean state. Neither hue ever crosses.**
- All raw hex lives in the `:root` / `[data-theme="dark"]` blocks of `dashboard/src/app/globals.css`. The only allowlisted exception anywhere else is `src/app/dashboard/clients/[id]/BrandingPanel.tsx`, where hex is *client data* (a colour input default and placeholder), not a design token.
- `text-white` (51 uses) is **left alone** — it only ever sits on dark fills that stay dark in both themes. Do **not** override `white` in the Tailwind config; doing so makes card text invisible in dark mode.
- Never reintroduce unsubstantiated claims to the login page ("SOC 2-aligned", "Enterprise-grade security"). Never hardcode a "System Status: Operational" that is wired to nothing.
- Keep the existing `prefers-reduced-motion` block in `globals.css` **verbatim**. It caps transitions at 90ms deliberately rather than deleting them, so hover/focus feedback survives.

**Verification gate — run after every task**

```bash
cd "C:/Users/VYRA/Desktop/Inbound Agent v4/dashboard"
npx tsc --noEmit          # must exit 0
npm run guards            # must exit 0 (created in Task 2)
npx eslint .              # see baseline below
npm run build             # must exit 0
```

**Measured baseline on `main` @ `3bc78db`** (re-measured 2026-08-11, do not trust older notes):
- `tsc --noEmit`: clean, exit 0
- `eslint .`: **1 error, 34 warnings**. The error is `src/app/dashboard/page.tsx:80` — `react-hooks/purity`, `Date.now()` called during render. Task 11 rewrites that file and fixes it.
- **Warnings must not increase above 34.** After Task 11 the error count must be **0**.

**Screenshots** — no Chrome extension is available on this machine. Use headless Chrome directly:

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --headless --disable-gpu --hide-scrollbars \
  --window-size=1440,2400 \
  --screenshot="<out>.png" "http://localhost:3000/<route>"
```

Chrome is confirmed present at that path. Dev server runs on **port 3000** (`npm run dev`).
**Windows clamps the window to a 500px minimum width**, so narrow-viewport shots report horizontal overflow that does not exist — never call an overflow bug from a shot below 500px.
Every screenshot is taken in **both themes** (toggle by setting `data-theme` on `<html>`).

---

## File Structure

**Created**
| File | Responsibility |
| --- | --- |
| `dashboard/scripts/design-guards.mjs` | The stand-in for tests: greps `src` for the four forbidden patterns, exits non-zero with file:line on any hit. |
| `dashboard/src/app/_tokens/page.tsx` | Throwaway token sheet rendering every primitive in both themes. Deleted at the end of Phase 3. |
| `dashboard/src/components/ThemeToggle.tsx` | The light/dark control. Owns `localStorage` reads/writes and the `data-theme` attribute. |

**Modified — the world**
| File | Change |
| --- | --- |
| `dashboard/src/app/globals.css` | The only home for raw hex. Both theme blocks, `.viz-root` made theme-aware, new hard-offset + hover-lift utilities. |
| `dashboard/tailwind.config.ts` | Rewritten: `var(--…)` references, radius scale zeroed, DM font stacks, hard-offset shadows. |
| `dashboard/src/app/layout.tsx` | DM Sans + DM Mono; pre-paint FOUC script; Toaster colours to tokens. |

**Deleted**
| File | Reason |
| --- | --- |
| `dashboard/src/lib/design-tokens.ts` | Dead. Verified not imported anywhere in `src`. 42 stale hex values (navy/sky/amber, Fira Code/Fira Sans) from the pre-2026-08-07 era that contradict the current design and would trip the hex guard. |

**Modified — 21 components** (`dashboard/src/components/`)
`StatusLamp` · `StatusPill` · `Badge` · `Sidebar` · `PageHeader` · `Tabs` · `Drawer` · `ConfirmDialog` · `KPICard` · `Table` · `DataTable` · `FilterBar` · `ClientPicker` · `InlineEditTable` · `TicketComposer` · `Hint` · `SlaCountdown` · `CopilotFaqs` · `charts/ChartCard` · `charts/VolumeChart` · `charts/OutcomeChart`

**Modified — pilot pages**
`dashboard/src/app/login/page.tsx` · `dashboard/src/app/dashboard/page.tsx`

---

## Task 1: The token layer

**Files:**
- Modify: `dashboard/src/app/globals.css`
- Modify: `dashboard/tailwind.config.ts`
- Modify: `dashboard/src/app/layout.tsx`
- Delete: `dashboard/src/lib/design-tokens.ts`

**Interfaces:**
- Produces: every CSS custom property named below; the Tailwind colour names `surface`, `surface-raised`, `surface-inset`, `surface-dark`, `surface-dark-inset`, `action`, `action-wash`, `action-rim`, `hairline`, `rule`, `edge`, plus the preserved legacy ramps `panel-*`, `ink-*`, `signal-*`, `lamp-*`, `primary-*`, `navy-*`, `gray-*`, `blue-*`, `emerald-*`, `green-*`, `amber-*`, `yellow-*`, `red-*`, `accent-*`, `brand-*`; the utilities `.lift`, `.offset-ink`, `.label-instrument`, `.card`.
- Consumes: nothing.

**Why RGB triplets.** Tailwind opacity modifiers (`bg-action/50`, `bg-lamp-bad/[0.14]` — the latter is live in `Sidebar.tsx`) only work if the colour resolves through `<alpha-value>`. So every **solid** token is stored as a space-separated RGB triplet and consumed as `rgb(var(--x-rgb) / <alpha-value>)`. Pre-composited `rgba()` is used **only** for the hairline/rule/text-alpha family, which no code applies an opacity modifier to.

**The inversion trick.** The neutral ramp (`--n-25` … `--n-950`) and the ink ramp flip end-for-end in the dark block. That is what makes all 294 legacy references theme-aware for free: `bg-panel-50` is near-bone in light and near-black in dark, with no file edits.

> **Hazard this creates, handled in Task 2:** 53 places use `bg-ink-900` / `bg-ink-800` / `bg-gray-900` as a *deliberately dark surface* (nav rail, login aside, scrims). Under inversion those become near-white in dark mode. Task 2 triages every one. Do not fix them here.

- [ ] **Step 1: Replace the `:root` block and add the dark block in `globals.css`**

Insert immediately after the `@tailwind utilities;` line, before `@layer base`:

```css
/* ============================================================
   THE TOKEN LAYER — the only place raw hex may appear.
   Values are from gravvia-site/assets/site.css.

   Solid colours are RGB triplets so Tailwind's `<alpha-value>`
   opacity modifiers keep working. Alpha-composited rgba() is
   used only where no opacity modifier is ever applied.
   ============================================================ */
:root {
  color-scheme: light;

  /* Brand constants — identical in both themes */
  --bone-rgb:      240 240 238;
  --ink-rgb:         3   3   3;
  --cobalt-rgb:     29  79 216;
  --cobalt-lt-rgb: 138 164 255;

  /* Neutral ramp: bone → ink. Inverted in the dark block. */
  --n-25-rgb:  250 250 249;
  --n-50-rgb:  244 244 242;
  --n-100-rgb: 233 233 230;
  --n-200-rgb: 216 216 212;
  --n-300-rgb: 188 188 184;
  --n-400-rgb: 147 147 143;
  --n-500-rgb: 110 110 106;
  --n-600-rgb:  84  84  81;
  --n-700-rgb:  65  65  62;
  --n-800-rgb:  43  43  41;
  --n-900-rgb:  26  26  25;
  --n-950-rgb:  14  14  13;

  /* Surfaces */
  --surface-rgb:            var(--bone-rgb);
  --surface-raised-rgb:     251 251 250;
  --surface-inset-rgb:      232 232 229;
  /* The dark panel. Deliberately dark in BOTH themes — bone body
     beside a #030303 panel is the site's actual composition. */
  --surface-dark-rgb:         3   3   3;
  --surface-dark-inset-rgb:  12  12  12;

  /* Text */
  --text-rgb:            var(--ink-rgb);
  --text-secondary: rgba(3, 3, 3, .70);
  --text-muted:     rgba(3, 3, 3, .55);
  --text-faint:     rgba(3, 3, 3, .40);
  /* On the dark panel, in both themes */
  --text-on-dark:           rgba(240, 240, 238, 1);
  --text-on-dark-secondary: rgba(240, 240, 238, .60);
  --text-on-dark-muted:     rgba(240, 240, 238, .55);

  /* Rules */
  --hairline: rgba(3, 3, 3, .12);
  --rule:     rgba(3, 3, 3, .22);
  --edge-rgb: var(--ink-rgb);

  /* Action */
  --action-rgb:          var(--cobalt-rgb);
  --action-hover-rgb:    23  67 184;
  --action-contrast-rgb: var(--bone-rgb);
  --action-wash:   rgba(29, 79, 216, .06);
  --action-wash-2: rgba(29, 79, 216, .10);
  --action-rim:    rgba(29, 79, 216, .35);

  /* Scrim behind floating layers */
  --scrim: rgba(3, 3, 3, .55);

  /* Lamps. Cores are lit lenses and never change between themes. */
  --lamp-good-rgb: 31 163  95;
  --lamp-fair-rgb: 224 146  26;
  --lamp-bad-rgb:  220  59  48;
  --lamp-good-ink-rgb: 14 112  66;
  --lamp-fair-ink-rgb: 138  86   0;
  --lamp-bad-ink-rgb:  168  30  23;
  --lamp-good-wash: #E6F5EC;
  --lamp-fair-wash: #FCF2E0;
  --lamp-bad-wash:  #FCEBEA;
  --lamp-good-rim:  #B4DFC6;
  --lamp-fair-rim:  #EFD5A6;
  --lamp-bad-rim:   #F0BDB8;
  --lamp-off-rgb:      194 200 200;
  --lamp-off-ink-rgb:  147 157 157;
}

[data-theme='dark'] {
  color-scheme: dark;

  /* Neutral ramp inverted: 25 is now the darkest. */
  --n-25-rgb:   10  10  10;
  --n-50-rgb:   14  14  13;
  --n-100-rgb:  26  26  25;
  --n-200-rgb:  43  43  41;
  --n-300-rgb:  65  65  62;
  --n-400-rgb: 110 110 106;
  --n-500-rgb: 147 147 143;
  --n-600-rgb: 188 188 184;
  --n-700-rgb: 216 216 212;
  --n-800-rgb: 233 233 230;
  --n-900-rgb: 244 244 242;
  --n-950-rgb: var(--bone-rgb);

  --surface-rgb:            var(--ink-rgb);
  --surface-raised-rgb:      12  12  12;
  --surface-inset-rgb:        0   0   0;
  --surface-dark-rgb:        12  12  12;
  --surface-dark-inset-rgb:  20  20  20;

  --text-rgb:       var(--bone-rgb);
  --text-secondary: rgba(240, 240, 238, .75);
  --text-muted:     rgba(240, 240, 238, .60);
  --text-faint:     rgba(240, 240, 238, .40);

  --hairline: rgba(240, 240, 238, .12);
  --rule:     rgba(240, 240, 238, .22);
  --edge-rgb: 240 240 238;

  --action-rgb:          var(--cobalt-lt-rgb);
  --action-hover-rgb:   168 188 255;
  --action-contrast-rgb: var(--ink-rgb);
  --action-wash:   rgba(138, 164, 255, .08);
  --action-wash-2: rgba(138, 164, 255, .14);
  --action-rim:    rgba(138, 164, 255, .35);

  --scrim: rgba(0, 0, 0, .72);

  /* Lamp cores hold. The text weights lighten so they clear 4.5:1
     on #030303, and the washes become dark tints instead of glowing. */
  --lamp-good-ink-rgb:  86 209 142;
  --lamp-fair-ink-rgb: 240 182  87;
  --lamp-bad-ink-rgb:  240 121 111;
  --lamp-good-wash: rgba(31, 163, 95, .12);
  --lamp-fair-wash: rgba(224, 146, 26, .12);
  --lamp-bad-wash:  rgba(220, 59, 48, .12);
  --lamp-good-rim:  rgba(31, 163, 95, .32);
  --lamp-fair-rim:  rgba(224, 146, 26, .32);
  --lamp-bad-rim:   rgba(220, 59, 48, .32);
  --lamp-off-rgb:      58  58  56;
  --lamp-off-ink-rgb: 110 110 106;
}
```

- [ ] **Step 2: Make `.viz-root` theme-aware and go two-colour**

Replace the entire existing `.viz-root` block at the bottom of `globals.css` — including its long comment about the unvalidated CVD gate, which no longer applies — with:

```css
/* ============================================================
   Data-visualisation tokens.

   Series identity is cobalt + ink at stepped opacity, separated
   by fill texture, not by a second hue. The site is a
   cobalt-and-ink binary and has no third colour; inventing one
   risks landing near a lamp. This is also CVD-safe by
   construction — luminance and texture carry identity — which
   retires the numeric CVD gate the previous teal/mulberry pair
   was never run through.
   ============================================================ */
.viz-root {
  --surface-1:      rgb(var(--surface-raised-rgb));
  --text-secondary: var(--text-secondary);
  --text-muted:     var(--text-muted);
  --gridline:       var(--hairline);
  --baseline:       var(--rule);
  --series-1:       rgb(var(--action-rgb));
  --series-2:       var(--text-muted);
}

.viz-root .recharts-surface:focus-visible {
  outline: 2px solid rgb(var(--action-rgb));
  outline-offset: 2px;
}
```

- [ ] **Step 3: Retarget the `@layer base` and `@layer components` blocks**

In `globals.css`, apply these edits. Leave the `prefers-reduced-motion` block and the `.animate-rise` keyframes **exactly as they are**.

```css
/* body */
body { @apply bg-surface text-text; }

/* the blanket border default */
* { border-color: var(--hairline); }

/* browser surfaces */
::selection { background-color: var(--action-wash-2); color: rgb(var(--text-rgb)); }
:root { caret-color: rgb(var(--action-rgb)); accent-color: rgb(var(--action-rgb)); }
/* NOTE: `color-scheme` is now set per-theme in the token blocks —
   remove it from here so the dark block can win. */

*::-webkit-scrollbar-thumb { background-color: rgb(var(--n-300-rgb)); }
*::-webkit-scrollbar-thumb:hover { background-color: rgb(var(--n-400-rgb)); }

:focus-visible {
  outline: 2px solid rgb(var(--action-rgb));
  outline-offset: 2px;
  border-radius: 0;            /* was 4px */
}

::placeholder { color: var(--text-muted); opacity: 1; }
```

Replace the `@layer components` block with:

```css
@layer components {
  /* Elevation is declared once: hairline OR hard offset, never both,
     and never a blurred shadow. */
  .card {
    @apply border bg-surface-raised;
    border-color: var(--hairline);
  }

  /* The outermost container edge — the site's `.device` treatment. */
  .card-edge {
    @apply border bg-surface-raised;
    border-color: rgb(var(--edge-rgb));
  }

  /* Small instrument label. Mono, per the transplant — this now IS
     used as an eyebrow above page headings, reversing the previous
     rule. See spec section 2. */
  .label-instrument {
    @apply font-mono text-2xs uppercase;
    letter-spacing: 0.16em;
    color: var(--text-muted);
  }

  .hairline { border-color: var(--hairline); }
}
```

- [ ] **Step 4: Add the motion utilities**

Append inside the existing `@layer utilities` block, above the `prefers-reduced-motion` media query:

```css
  /* The physical press the hard shadow implies. Hover lifts the card
     and the cobalt offset appears beneath it; press collapses it. */
  .lift {
    transition: transform 150ms cubic-bezier(.16, 1, .3, 1),
                box-shadow 150ms cubic-bezier(.16, 1, .3, 1);
  }
  .lift:hover {
    transform: translateY(-2px);
    box-shadow: 6px 6px 0 0 rgb(var(--action-rgb));
  }
  .lift:active {
    transform: translateY(0);
    box-shadow: 2px 2px 0 0 rgb(var(--action-rgb));
  }
```

Then add `.lift` to the existing reduced-motion reset list so it stops travelling:

```css
    .animate-rise,
    .animate-lamp-live,
    .animate-sweep {
      animation: none !important;
    }
    .lift:hover, .lift:active { transform: none; }
```

- [ ] **Step 5: Rewrite `tailwind.config.ts`**

Replace the file entirely:

```ts
import type { Config } from 'tailwindcss';

/**
 * GRAVVIA ENGAGE — token bindings.
 *
 * This file contains NO colour values. Every colour resolves to a CSS
 * custom property defined in src/app/globals.css, which is the single
 * home for raw hex. That indirection is what makes dark mode one
 * attribute on <html> instead of a `dark:` variant in 69 files.
 *
 * Two rules carried forward from the 2026-08-07 revamp:
 *  1. NAMES ARE PRESERVED, VALUES ARE REPLACED. Legacy ramps keep
 *     their names so the ~20 routes never hand-revised inherit the new
 *     world instead of rendering unstyled.
 *  2. Elevation is declared once: hairline border OR hard offset,
 *     never both, and never a blurred shadow.
 *
 * The rule that CHANGED: chroma is no longer reserved for state.
 * Cobalt means "you can act on this"; green/amber/red mean state.
 * Neither hue ever crosses into the other's job.
 */

/** Solid token → `rgb(var(--x) / <alpha-value>)`, so `bg-action/50` works. */
const c = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

const neutral = {
  25: c('--n-25-rgb'),   50: c('--n-50-rgb'),   100: c('--n-100-rgb'),
  200: c('--n-200-rgb'), 300: c('--n-300-rgb'), 400: c('--n-400-rgb'),
  500: c('--n-500-rgb'), 600: c('--n-600-rgb'), 700: c('--n-700-rgb'),
  800: c('--n-800-rgb'), 900: c('--n-900-rgb'), 950: c('--n-950-rgb'),
};

// The interactive/text ramp. Same inverted neutral ends — `ink-900` is
// the strongest text colour in either theme.
const ink = {
  50: c('--n-50-rgb'),   100: c('--n-100-rgb'), 200: c('--n-200-rgb'),
  300: c('--n-300-rgb'), 400: c('--n-400-rgb'), 500: c('--n-500-rgb'),
  600: c('--n-600-rgb'), 700: c('--n-700-rgb'), 800: c('--n-800-rgb'),
  900: c('--n-950-rgb'),
};

// Cobalt, exposed as a ramp so the 199 existing `signal-*` references
// land on the brand colour in place.
const action = {
  50: 'var(--action-wash)',   100: 'var(--action-wash-2)',
  200: 'var(--action-rim)',   300: 'var(--action-rim)',
  400: c('--action-rgb'),     500: c('--action-rgb'),
  600: c('--action-rgb'),     700: c('--action-rgb'),
  800: c('--action-hover-rgb'), 900: c('--action-hover-rgb'),
  DEFAULT: c('--action-rgb'),
};

const lamp = {
  good: c('--lamp-good-rgb'),
  'good-ink': c('--lamp-good-ink-rgb'),
  'good-wash': 'var(--lamp-good-wash)',
  'good-rim': 'var(--lamp-good-rim)',
  fair: c('--lamp-fair-rgb'),
  'fair-ink': c('--lamp-fair-ink-rgb'),
  'fair-wash': 'var(--lamp-fair-wash)',
  'fair-rim': 'var(--lamp-fair-rim)',
  bad: c('--lamp-bad-rgb'),
  'bad-ink': c('--lamp-bad-ink-rgb'),
  'bad-wash': 'var(--lamp-bad-wash)',
  'bad-rim': 'var(--lamp-bad-rim)',
  off: c('--lamp-off-rgb'),
  'off-ink': c('--lamp-off-ink-rgb'),
};

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ---- Semantic surface tokens (new; prefer these) ----
        surface: {
          DEFAULT: c('--surface-rgb'),
          raised: c('--surface-raised-rgb'),
          inset: c('--surface-inset-rgb'),
          dark: c('--surface-dark-rgb'),
          'dark-inset': c('--surface-dark-inset-rgb'),
        },
        text: {
          DEFAULT: c('--text-rgb'),
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
          faint: 'var(--text-faint)',
          'on-dark': 'var(--text-on-dark)',
          'on-dark-secondary': 'var(--text-on-dark-secondary)',
          'on-dark-muted': 'var(--text-on-dark-muted)',
        },
        action: action,
        hairline: 'var(--hairline)',
        rule: 'var(--rule)',
        edge: c('--edge-rgb'),
        scrim: 'var(--scrim)',
        lamp,

        // ---- Legacy names preserved, values replaced ----
        panel: neutral,
        ink,
        signal: action,      // was teal; cobalt takes the role
        primary: action,     // was graphite; the brand colour now leads
        navy: neutral,
        gray: neutral,
        secondary: action,
        blue: action,        // finally true — blue IS the brand
        accent: {
          50: 'var(--lamp-fair-wash)', 100: 'var(--lamp-fair-wash)',
          200: 'var(--lamp-fair-rim)',
          500: c('--lamp-fair-rgb'), 600: c('--lamp-fair-ink-rgb'),
        },
        brand: {
          50: 'var(--action-wash)', 500: c('--action-rgb'),
          600: c('--action-rgb'), 700: c('--action-hover-rgb'),
        },
        emerald: {
          50: 'var(--lamp-good-wash)', 100: 'var(--lamp-good-wash)',
          200: 'var(--lamp-good-rim)', 300: 'var(--lamp-good-rim)',
          500: c('--lamp-good-rgb'), 600: c('--lamp-good-ink-rgb'),
          700: c('--lamp-good-ink-rgb'), 800: c('--lamp-good-ink-rgb'),
          900: c('--lamp-good-ink-rgb'),
        },
        green: {
          50: 'var(--lamp-good-wash)', 100: 'var(--lamp-good-wash)',
          200: 'var(--lamp-good-rim)', 300: 'var(--lamp-good-rim)',
          500: c('--lamp-good-rgb'), 600: c('--lamp-good-ink-rgb'),
          700: c('--lamp-good-ink-rgb'), 800: c('--lamp-good-ink-rgb'),
          900: c('--lamp-good-ink-rgb'),
        },
        amber: {
          50: 'var(--lamp-fair-wash)', 100: 'var(--lamp-fair-wash)',
          200: 'var(--lamp-fair-rim)', 300: 'var(--lamp-fair-rim)',
          500: c('--lamp-fair-rgb'), 600: c('--lamp-fair-ink-rgb'),
          700: c('--lamp-fair-ink-rgb'), 800: c('--lamp-fair-ink-rgb'),
          900: c('--lamp-fair-ink-rgb'),
        },
        yellow: {
          50: 'var(--lamp-fair-wash)', 100: 'var(--lamp-fair-wash)',
          200: 'var(--lamp-fair-rim)',
          500: c('--lamp-fair-rgb'), 600: c('--lamp-fair-ink-rgb'),
          700: c('--lamp-fair-ink-rgb'), 800: c('--lamp-fair-ink-rgb'),
          900: c('--lamp-fair-ink-rgb'),
        },
        red: {
          50: 'var(--lamp-bad-wash)', 100: 'var(--lamp-bad-wash)',
          200: 'var(--lamp-bad-rim)', 300: 'var(--lamp-bad-rim)',
          500: c('--lamp-bad-rgb'), 600: c('--lamp-bad-ink-rgb'),
          700: c('--lamp-bad-ink-rgb'), 800: c('--lamp-bad-ink-rgb'),
          900: c('--lamp-bad-ink-rgb'),
        },
      },

      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        heading: ['var(--font-sans)', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },

      // Kept — this scale is tuned for console density. Tracking retuned
      // for DM Sans, whose default fit is looser than Archivo's.
      fontSize: {
        '2xs': ['11px', { lineHeight: '14px', letterSpacing: '0.02em' }],
        xs: ['12px', { lineHeight: '16px' }],
        sm: ['13px', { lineHeight: '19px' }],
        base: ['15px', { lineHeight: '23px' }],
        lg: ['17px', { lineHeight: '26px' }],
        xl: ['20px', { lineHeight: '28px', letterSpacing: '-0.012em' }],
        '2xl': ['25px', { lineHeight: '31px', letterSpacing: '-0.02em' }],
        '3xl': ['31px', { lineHeight: '36px', letterSpacing: '-0.022em' }],
        '4xl': ['39px', { lineHeight: '42px', letterSpacing: '-0.026em' }],
        '5xl': ['49px', { lineHeight: '52px', letterSpacing: '-0.03em' }],
      },

      // HARD OFFSETS ONLY. No blur, no zero-offset halos. `xs`..`xl` keep
      // their names so untouched routes inherit the new world; they all
      // resolve to the ink offset, because a floating layer is the only
      // thing in this system that may cast one.
      boxShadow: {
        none: 'none',
        xs: '2px 2px 0 0 rgb(var(--edge-rgb) / 0.10)',
        sm: '3px 3px 0 0 rgb(var(--edge-rgb) / 0.12)',
        md: '4px 4px 0 0 rgb(var(--edge-rgb) / 0.16)',
        lg: '6px 6px 0 0 rgb(var(--edge-rgb) / 0.20)',
        xl: '8px 8px 0 0 rgb(var(--edge-rgb) / 0.24)',
        cobalt: '6px 6px 0 0 rgb(var(--action-rgb))',
        'cobalt-sm': '3px 3px 0 0 rgb(var(--action-rgb))',
        seat: 'none',   // the old inset-highlight look has no place in a flat world
      },

      // Radius 0 on every named step. All 335 existing `rounded-*` classes
      // go square with zero file edits; `rounded-full` keeps the dots round.
      borderRadius: {
        none: '0', sm: '0', DEFAULT: '0', md: '0',
        lg: '0', xl: '0', '2xl': '0', '3xl': '0',
        full: '9999px',
      },

      transitionTimingFunction: { out: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      transitionDuration: { 120: '120ms', 150: '150ms', 200: '200ms', 300: '300ms' },

      keyframes: {
        pulse_lamp: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.55', transform: 'scale(0.88)' },
        },
        sweep: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'lamp-live': 'pulse_lamp 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        sweep: 'sweep 1.6s cubic-bezier(0.16, 1, 0.3, 1) infinite',
      },
    },
  },
  plugins: [],
};

export default config;
```

- [ ] **Step 6: Swap the fonts and add the pre-paint theme script in `layout.tsx`**

Replace the two font imports and their declarations:

```ts
import { DM_Sans, DM_Mono } from 'next/font/google';

// DM Sans — the marketing site's face. Body runs at 400; the site's 300
// is unreadable at 13px, so 300 is reserved for display sizes >= 25px.
const sans = DM_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '700'],
  variable: '--font-sans',
  display: 'swap',
});

// DM Mono carries every micro-label and every figure.
// NOTE: DM Mono ships 300/400/500 ONLY — there is no 600 or 700. The
// previous JetBrains_Mono declaration requested 600; requesting it here
// fails the build. (Verified: no `font-mono` + `font-semibold` class
// pairs exist in src, so nothing downstream needs the missing weight.)
const mono = DM_Mono({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-mono',
  display: 'swap',
});
```

Replace the `DIRECTION_CONTRACT` constant's contents:

```ts
const DIRECTION_CONTRACT = `<!-- impeccable:direction seed=none-roll-unavailable
THESIS: The console is the same building as gravvia.com. Bone, ink, and
cobalt; corners are zero; the only shadows are hard cobalt offsets.
OWN-WORLD: DM Sans and DM Mono. Mono carries every micro-label and every
figure. Cobalt means "you can act on this"; green/amber/red mean state;
neither hue crosses into the other's job.
STORY: The operator learns what is wrong before reading a word, then
reaches the failing record in one move.
FIRST VIEWPORT: Dark console rail against bone; a hard-ruled lamp strip
reporting live system state from real severity counts; the worst-first
register beneath it.
FORM: Brand transplant from the shipped marketing site, not a roll.
FINISH: unreviewed and undocumented is unfinished; this build ends with
the finish review, the verdict, and DESIGN.md
-->`;
```

Rewrite the `RootLayout` return. The theme script must run **before first paint** or the bone world flashes on every dark-mode load:

```tsx
/**
 * Runs before first paint. Without this the browser paints the light
 * default, then React swaps to dark — a visible flash on every load.
 * Stringified because it must be inline; it cannot wait for hydration.
 */
const THEME_BOOT = `(function(){try{var t=localStorage.getItem('gravvia_theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="font-sans antialiased">
        <div hidden aria-hidden dangerouslySetInnerHTML={{ __html: DIRECTION_CONTRACT }} />
        {children}
        <Toaster
          position="bottom-right"
          containerClassName="z-50"
          toastOptions={{
            duration: 4000,
            className: 'text-sm',
            // Tokens, not hex — these must follow the theme.
            style: {
              background: 'rgb(var(--surface-raised-rgb))',
              color: 'rgb(var(--text-rgb))',
              border: '1px solid var(--hairline)',
              borderRadius: 0,
            },
            success: { iconTheme: { primary: 'rgb(var(--lamp-good-rgb))', secondary: 'rgb(var(--surface-raised-rgb))' } },
            error: { duration: 6000, iconTheme: { primary: 'rgb(var(--lamp-bad-rgb))', secondary: 'rgb(var(--surface-raised-rgb))' } },
          }}
        />
      </body>
    </html>
  );
}
```

`suppressHydrationWarning` on `<html>` is required: the boot script mutates the element before React hydrates, and without it React logs a mismatch on every dark-mode load.

- [ ] **Step 7: Delete the dead token file**

```bash
cd "C:/Users/VYRA/Desktop/Inbound Agent v4/dashboard"
git rm src/lib/design-tokens.ts
```

Confirm it really was dead before trusting this — the command must print nothing:

```bash
grep -rn "design-tokens" src --include=*.ts --include=*.tsx
```

- [ ] **Step 8: Verify**

```bash
npx tsc --noEmit          # expect: exit 0
npm run build             # expect: exit 0, and NO "unknown font weight" error
npx eslint .              # expect: 1 error, 34 warnings (unchanged baseline)
```

If `npm run build` reports a font weight error, DM Mono's missing 600 is the cause — re-check Step 6.

- [ ] **Step 9: Eyeball it before committing**

```bash
npm run dev &
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless --disable-gpu \
  --hide-scrollbars --window-size=1440,2000 \
  --screenshot="../../../AppData/Local/Temp/claude/t1-login.png" \
  "http://localhost:3000/login"
```

Expected: everything square, bone background, cobalt buttons and focus rings, DM Sans throughout. The nav rail and login aside will look **wrong in dark mode** — that is the known inversion hazard, and Task 2 fixes it. Do not chase it here.

- [ ] **Step 10: Commit**

```bash
git add src/app/globals.css tailwind.config.ts src/app/layout.tsx
git commit -m "feat(dashboard): cobalt token layer, dark mode vars, DM type

All colour moves to CSS custom properties in globals.css, the single home
for raw hex. tailwind.config.ts holds only var() references. Legacy ramps
are preserved and repointed so 335 rounded-*, 199 signal-*, and 294 legacy
colour references convert at the config layer.

Deletes src/lib/design-tokens.ts — dead, unimported, 42 stale hex values
from the pre-revamp era."
```

---

## Task 2: Design guards, and making the codebase pass them

**Files:**
- Create: `dashboard/scripts/design-guards.mjs`
- Modify: `dashboard/package.json` (add the `guards` script)
- Modify: ~25 files across `dashboard/src` (mechanical sweeps below)

**Interfaces:**
- Consumes: the token names produced by Task 1.
- Produces: `npm run guards` — exits 0 clean, non-zero with `file:line` per violation. Every later task's gate depends on it.

**Why this task exists.** The workspace has no test framework and adding one is out of scope. These greps are the closest thing to a regression test this facelift can have: they catch the four ways the new world silently rots.

- [ ] **Step 1: Write the guard script**

Create `dashboard/scripts/design-guards.mjs`:

```js
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

const SRC = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

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
```

- [ ] **Step 2: Register the script**

In `dashboard/package.json`, add to `"scripts"`:

```json
"guards": "node scripts/design-guards.mjs"
```

- [ ] **Step 3: Run it and capture the work list**

```bash
npm run guards 2>&1 | tee "$SCRATCH/guards-before.txt"
```

Expect roughly 145 `bg-white`, ~330 `rounded-*`, and ~32 hex. It will be long. That list is the task.

- [ ] **Step 4: Sweep `bg-white` → `bg-surface-raised`**

145 occurrences. Mechanical and safe — every one is a card, panel, input, or menu fill.

```bash
cd "C:/Users/VYRA/Desktop/Inbound Agent v4/dashboard"
grep -rl "bg-white" src | xargs sed -i 's/\bbg-white\b/bg-surface-raised/g'
```

Then check for the case where that substitution is wrong — a light fill sitting **on** a dark panel, which must stay light in both themes and would go dark under `surface-raised`:

```bash
grep -rn "bg-surface-raised" src | grep -iE "on-dark|surface-dark|ink-900"
```

If there are hits, do **not** reach for an arbitrary value. Add a proper token: `--surface-on-dark-rgb: 240 240 238;` in **both** theme blocks of `globals.css` (identical in each — that is the point), a `'on-dark': c('--surface-on-dark-rgb')` entry under `surface` in the config, then use `bg-surface-on-dark` at those sites.

- [ ] **Step 5: Strip `rounded-*`**

Radius is already 0 by config, so these classes are inert — but leaving ~330 of them means the next person believes corners exist here. Remove all except `rounded-full`:

`sed -E` has no negative lookahead, so protecting `rounded-full` with a single expression is not possible. Use a sentinel in three passes:

```bash
cd "C:/Users/VYRA/Desktop/Inbound Agent v4/dashboard"

# 1. Park the one class that survives.
grep -rl "rounded-full" src | xargs sed -i 's/\brounded-full\b/ROUNDKEEP/g'

# 2. Strip every remaining radius class, including the bare `rounded`,
#    and collapse the double space the removal leaves behind.
grep -rlE "\brounded" src | xargs sed -i -E \
  -e 's/\brounded-(none|sm|md|lg|xl|2xl|3xl|\[[^]]*\])\b//g' \
  -e 's/\brounded\b//g' \
  -e 's/(class(Name)?=")([^"]*)"/\1\3"/g'

# 3. Restore it.
grep -rl "ROUNDKEEP" src | xargs sed -i 's/\bROUNDKEEP\b/rounded-full/g'
```

Verify — this must print nothing:

```bash
grep -rnE "\brounded(-[a-z0-9[]+)?\b" src | grep -v "rounded-full"
```

Pass 2's third expression does not actually collapse inner runs of spaces (sed's `s///` on the whole attribute is a no-op there). Clean those up from the diff by hand:

```bash
git diff -U0 | grep -nE 'class(Name)?="[^"]*  ' | head -40
```

Double spaces inside a `className` are harmless to the browser but noisy in review. Fix only the ones the diff surfaces — never run a blanket whitespace collapse over a whole file, which would reformat unrelated code.

- [ ] **Step 6: Triage the 53 dark-surface fills**

This is the one part of the sweep that is **not** mechanical, and getting it wrong is the single most visible dark-mode bug. The neutral ramp inverts, so `bg-ink-900` — currently near-black — becomes near-**bone** in dark mode.

Find them:

```bash
grep -rn -E "bg-(ink|navy|panel|gray)-(8|9)[05]0" src
```

Each hit is one of two kinds. Decide by asking *what is this fill for?*

| Kind | Examples | Replace with |
| --- | --- | --- |
| **A deliberately dark surface** — nav rail, login aside, a scrim | `Sidebar.tsx:130`, `:260`, `:281`; `login/page.tsx:65`; `Drawer.tsx:79` (scrim) | `bg-surface-dark` (panels) or `bg-scrim` (scrims). Text on these goes to `text-on-dark` / `text-on-dark-secondary` / `text-on-dark-muted`. |
| **An interactive dark fill** — a primary button, a dark badge | `login/page.tsx:205`; `ConfirmDialog.tsx:159`; `TicketComposer.tsx:115`, `:165`; `CopilotFaqs.tsx:122`; `Badge.tsx:22`; `queue/page.tsx:289` | `bg-action text-[rgb(var(--action-contrast-rgb))]` with `hover:bg-action-800`. These are actions, and actions are cobalt now. |

`Drawer.tsx:79` is a scrim, not a panel — check the surrounding JSX before assuming. Likewise `Sidebar.tsx:281`, which is the mobile overlay backdrop (`bg-ink-900/60`) and should become `bg-scrim`.

Also sweep the `white/[0.0x]` alpha fills used on the dark rail (12 occurrences) — those are correct as-is because they sit on a surface that is dark in both themes. **Leave them.**

- [ ] **Step 7: Retire the 12 stray hex values**

| File | Current | Replace with |
| --- | --- | --- |
| `app/dashboard/analytics/page.tsx:84-86` | `fill: '#3b5bdb'`, `'#40c057'`, `'#7950f2'` | `fill: 'var(--series-1)'`, `'var(--series-2)'`, `'var(--series-1)'`. **`#40c057` is a lamp-green used as a chart series** — a live violation of the colour rule, not just an off-token value. |
| `app/dashboard/analytics/page.tsx:166` | `stroke="#f1f3f4"` | `stroke="var(--gridline)"` |
| `app/dashboard/analytics/page.tsx:170` | `fill="#3b5bdb" radius={[4,4,0,0]}` | `fill="var(--series-1)"`, drop the `radius` prop — bars are square now. |
| `app/dashboard/knowledge/components/PoliciesEditor.tsx:86` | `background: '#FCF2E0', color: '#8A5600', border: '1px solid #EFD5A6'` | `background: 'var(--lamp-fair-wash)', color: 'rgb(var(--lamp-fair-ink-rgb))', border: '1px solid var(--lamp-fair-rim)'` |
| `app/dashboard/knowledge/components/CategoryEditor.tsx:105` | same three values | same three replacements |
| `components/ConfirmDialog.tsx:158` | `hover:bg-[#8d1811]` | `hover:bg-lamp-bad` |
| `components/StatusLamp.tsx` (9 values) | the `LENS` record | Task 4 handles this. **Skip here.** |
| `app/layout.tsx` (2 values) | Toaster `iconTheme` | Task 1 already replaced these. Confirm clean. |

Ensure the analytics page's chart is inside a `.viz-root` ancestor, or `var(--series-1)` resolves to nothing and the bars render black. Check:

```bash
grep -n "viz-root" src/app/dashboard/analytics/page.tsx
```

If absent, wrap the chart container in `<div className="viz-root">`.

- [ ] **Step 8: Verify the guards pass**

```bash
npm run guards            # expect: "design-guards: clean", exit 0
npx tsc --noEmit          # expect: exit 0
npx eslint .              # expect: 1 error, 34 warnings — unchanged
npm run build             # expect: exit 0
```

`npm run guards` reporting only `StatusLamp.tsx` hex is **acceptable at this point** — Task 4 owns that file. If so, temporarily note it; do not weaken the guard to hide it.

- [ ] **Step 9: Commit**

```bash
git add scripts/design-guards.mjs package.json src
git commit -m "feat(dashboard): design guards + sweep to token colours

Adds npm run guards — four greps standing in for the tests this
workspace does not have: stray hex, resurrected radius, bg-white, and
leftover teal.

Sweeps 145 bg-white to bg-surface-raised, strips ~330 inert rounded-*,
and triages 53 dark-surface fills that the inverted neutral ramp would
otherwise flip to near-white in dark mode.

Fixes a live colour-rule violation: analytics/page.tsx used lamp-green
#40c057 as a chart series."
```

---

## Task 3: The token sheet — first visual checkpoint

**Files:**
- Create: `dashboard/src/app/_tokens/page.tsx`

**Interfaces:**
- Consumes: every token from Task 1.
- Produces: `http://localhost:3000/_tokens` — the reference surface every later task screenshots against.

**Purpose.** This page is cheap to change; rebuilding 21 primitives is not. It is reviewed **before** any component or page work begins. It is deleted at the end of Phase 3.

- [ ] **Step 1: Create the token sheet**

```tsx
/**
 * TOKEN SHEET — throwaway. Deleted at the end of Phase 3.
 *
 * Renders the raw token layer and the base atoms so the world can be
 * judged before 21 primitives are rebuilt on top of it. Not linked from
 * anywhere and not part of the product.
 */
'use client';

import { useState } from 'react';

const NEUTRALS = [25, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
const LAMPS = ['good', 'fair', 'bad', 'off'] as const;

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-hairline py-8">
      <h2 className="label-instrument mb-4">{title}</h2>
      <div className="flex flex-wrap items-end gap-3">{children}</div>
    </section>
  );
}

export default function TokenSheet() {
  const [dark, setDark] = useState(false);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light');
  };

  return (
    <div className="min-h-screen bg-surface px-8 py-10 text-text">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-baseline justify-between">
          <div>
            <p className="label-instrument">Gravvia Engage</p>
            <h1 className="mt-1 font-heading text-4xl font-medium">Token sheet</h1>
          </div>
          <button
            onClick={toggle}
            className="border border-action bg-action px-4 py-2 font-mono text-2xs uppercase tracking-[0.16em] text-[rgb(var(--action-contrast-rgb))] transition-colors hover:bg-transparent hover:text-action"
          >
            {dark ? 'Light' : 'Dark'}
          </button>
        </div>

        <Row title="Neutral ramp — inverts between themes">
          {NEUTRALS.map((n) => (
            <div key={n} className="text-center">
              <div className={`h-14 w-14 border border-hairline bg-panel-${n}`} />
              <p className="mt-1 font-mono text-2xs text-text-muted">{n}</p>
            </div>
          ))}
        </Row>

        <Row title="Action — cobalt">
          {(['bg-action-50', 'bg-action-100', 'bg-action-200', 'bg-action', 'bg-action-800'] as const).map((c) => (
            <div key={c} className="text-center">
              <div className={`h-14 w-14 border border-hairline ${c}`} />
              <p className="mt-1 font-mono text-2xs text-text-muted">{c.replace('bg-', '')}</p>
            </div>
          ))}
        </Row>

        <Row title="Lamps — chroma is state, and only state">
          {LAMPS.map((l) => (
            <div key={l} className="flex items-center gap-2 border border-hairline px-3 py-2">
              <span className={`h-3 w-3 rounded-full bg-lamp-${l}`} />
              <span className={`font-mono text-2xs uppercase tracking-[0.16em] text-lamp-${l}-ink`}>{l}</span>
            </div>
          ))}
        </Row>

        <Row title="Surfaces">
          <div className="h-20 w-40 border border-hairline bg-surface p-2 font-mono text-2xs">surface</div>
          <div className="h-20 w-40 border border-hairline bg-surface-raised p-2 font-mono text-2xs">raised</div>
          <div className="h-20 w-40 border border-hairline bg-surface-inset p-2 font-mono text-2xs">inset</div>
          <div className="h-20 w-40 bg-surface-dark p-2 font-mono text-2xs text-text-on-dark">dark</div>
        </Row>

        <Row title="Type — DM Sans / DM Mono">
          <div className="w-full space-y-2">
            <p className="font-heading text-5xl font-light">Display 300 · 49px</p>
            <p className="font-heading text-2xl font-medium">Heading 500 · 25px</p>
            <p className="text-base">Body 400 · 15px — the voice answers, the system decides.</p>
            <p className="text-sm text-text-secondary">Secondary 13px</p>
            <p className="font-mono text-2xs uppercase tracking-[0.16em] text-text-muted">Mono micro-label · 11px</p>
            <p className="font-mono text-sm tabular-nums">0123456789 · tabular figures</p>
          </div>
        </Row>

        <Row title="Controls">
          <button className="border border-action bg-action px-5 py-2.5 text-sm font-medium text-[rgb(var(--action-contrast-rgb))] transition-colors duration-150 hover:bg-transparent hover:text-action">
            Primary
          </button>
          <button className="border border-rule px-5 py-2.5 text-sm font-medium transition-colors duration-150 hover:border-action hover:text-action">
            Secondary
          </button>
          <input
            placeholder="you@company.com"
            className="border border-rule bg-surface-raised px-3 py-2.5 text-sm placeholder:text-text-muted focus:border-action focus:outline-none"
          />
        </Row>

        <Row title="Elevation — hard offsets, no blur">
          <div className="lift cursor-pointer border border-hairline bg-surface-raised px-6 py-8 text-sm">
            .lift — hover me
          </div>
          <div className="border border-edge bg-surface-raised px-6 py-8 text-sm shadow-cobalt">
            shadow-cobalt
          </div>
          <div className="border border-hairline bg-surface-raised px-6 py-8 text-sm shadow-lg">
            shadow-lg (ink)
          </div>
        </Row>

        <Row title="Chart series — cobalt + ink, texture not hue">
          <div className="viz-root flex w-full items-end gap-2" style={{ height: 120 }}>
            {[70, 45, 90, 30, 60].map((h, i) => (
              <div key={i} className="flex-1" style={{ height: `${h}%`, background: 'var(--series-1)' }} />
            ))}
            {[40, 55, 25].map((h, i) => (
              <div key={`b${i}`} className="flex-1" style={{ height: `${h}%`, background: 'var(--series-2)' }} />
            ))}
          </div>
        </Row>
      </div>
    </div>
  );
}
```

Note the dynamic class names (`bg-panel-${n}`, `bg-lamp-${l}`) — Tailwind cannot see those at build time and will purge them. Add a safelist comment at the top of the file so a reader knows, and force them into the build by listing them explicitly:

```tsx
/* eslint-disable @typescript-eslint/no-unused-vars */
// Tailwind scans source text, so interpolated class names are purged.
// This literal array is never rendered; it exists to be scanned.
const _SAFELIST = [
  'bg-panel-25','bg-panel-50','bg-panel-100','bg-panel-200','bg-panel-300','bg-panel-400',
  'bg-panel-500','bg-panel-600','bg-panel-700','bg-panel-800','bg-panel-900','bg-panel-950',
  'bg-lamp-good','bg-lamp-fair','bg-lamp-bad','bg-lamp-off',
  'text-lamp-good-ink','text-lamp-fair-ink','text-lamp-bad-ink','text-lamp-off-ink',
];
```

- [ ] **Step 2: Verify**

```bash
npm run guards && npx tsc --noEmit && npm run build
```

- [ ] **Step 3: Screenshot both themes**

```bash
npm run dev &
CH="/c/Program Files/Google/Chrome/Application/chrome.exe"
"$CH" --headless --disable-gpu --hide-scrollbars --window-size=1440,2600 \
  --screenshot="$SCRATCH/tokens-light.png" "http://localhost:3000/_tokens"
```

For the dark shot, click the toggle is not possible headlessly — instead temporarily change the `useState(false)` default to `useState(true)` **and** set the attribute on mount, take the shot, then revert. Simpler and less error-prone: add `?theme=dark` handling:

```tsx
  const [dark, setDark] = useState(
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('theme') === 'dark'
  );
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, [dark]);
```

(Import `useEffect` alongside `useState`.) Then:

```bash
"$CH" --headless --disable-gpu --hide-scrollbars --window-size=1440,2600 \
  --screenshot="$SCRATCH/tokens-dark.png" "http://localhost:3000/_tokens?theme=dark"
```

- [ ] **Step 4: STOP — show the user both screenshots**

Do not begin Task 4 until the user has seen `tokens-light.png` and `tokens-dark.png` and approved or redirected. This is the checkpoint the whole pilot-first rollout exists to create.

- [ ] **Step 5: Commit**

```bash
git add src/app/_tokens/page.tsx
git commit -m "feat(dashboard): token sheet for the cobalt world

Throwaway reference surface rendering the token layer and base atoms in
both themes. Reviewed before the 21 primitives are rebuilt on it.
Deleted at the end of Phase 3."
```

---

## Task 4: Lamps and status

**Files:**
- Modify: `dashboard/src/components/StatusLamp.tsx`
- Modify: `dashboard/src/components/StatusPill.tsx`
- Modify: `dashboard/src/components/Badge.tsx`

**Interfaces:**
- Consumes: `--lamp-*` tokens from Task 1.
- Produces: unchanged public API. `StatusLamp({ level, size, live, delayMs, label, className })`, `LampStatus({ level, label, icon, live, seated, className })`, `SeverityLamp({ severity, seated })`, `SyncLamp({ state, seated })`, `ReviewLamp({ reviewedAt })`. `LampLevel = 'good' | 'fair' | 'bad' | 'off'`. **Do not change any signature** — 20+ routes consume these.

**Do not flatten the lens.** `StatusLamp` is already accessible done right: the three states differ in lens structure and brightness, not only hue, and a lamp with no visible word carries an `sr-only` one. That survives greyscale printing and every form of colour blindness. The only changes are theme-awareness and the seated chip's radius.

- [ ] **Step 1: Move the `LENS` record onto tokens**

In `StatusLamp.tsx`, replace the hardcoded `LENS` constant (the 9 hex values the guard flags):

```ts
/**
 * The lens reads from tokens so it follows the theme. Cores hold across
 * both themes — a lit lamp is a lit lamp — while the glow alpha lifts in
 * dark mode, where a 30% halo on near-black is invisible.
 */
const LENS: Record<LampLevel, { core: string; rim: string; glow: string; word: string }> = {
  good: {
    core: 'rgb(var(--lamp-good-rgb))',
    rim: 'rgb(var(--lamp-good-ink-rgb))',
    glow: 'rgb(var(--lamp-good-rgb) / var(--lamp-glow))',
    word: 'Good',
  },
  fair: {
    core: 'rgb(var(--lamp-fair-rgb))',
    rim: 'rgb(var(--lamp-fair-ink-rgb))',
    glow: 'rgb(var(--lamp-fair-rgb) / var(--lamp-glow))',
    word: 'Fair',
  },
  bad: {
    core: 'rgb(var(--lamp-bad-rgb))',
    rim: 'rgb(var(--lamp-bad-ink-rgb))',
    glow: 'rgb(var(--lamp-bad-rgb) / var(--lamp-glow))',
    word: 'Bad',
  },
  off: {
    core: 'rgb(var(--lamp-off-rgb))',
    rim: 'rgb(var(--lamp-off-ink-rgb))',
    glow: 'transparent',
    word: 'No signal',
  },
};
```

Add `--lamp-glow` to both theme blocks in `globals.css`:

```css
/* in :root */
  --lamp-glow: 0.32;
/* in [data-theme='dark'] */
  --lamp-glow: 0.55;
```

The specular highlight in the lens `background` also carries `rgba(255,255,255,…)` literals. Those are correct in both themes — the highlight is light reflecting off a glass lens — so leave them, but they will trip the hex guard only if written as hex. They are `rgba()`, so they pass. Verify with `npm run guards`.

The `unlit` branch uses `#EDEFEF`. Replace with `rgb(var(--n-100-rgb))`.

- [ ] **Step 2: Square the seated chip**

In the `SEATED` record and the `LampStatus` `clsx` call, remove `rounded-full`:

```ts
const SEATED: Record<LampLevel, string> = {
  good: 'bg-lamp-good-wash border-lamp-good-rim',
  fair: 'bg-lamp-fair-wash border-lamp-fair-rim',
  bad: 'bg-lamp-bad-wash border-lamp-bad-rim',
  off: 'bg-panel-100 border-hairline',
};
```

```tsx
        seated && ['border px-2.5 py-1', SEATED[level]],
```

And set the label in mono, which is the transplant's treatment for every status key:

```tsx
      'inline-flex items-center gap-2 whitespace-nowrap font-mono text-2xs uppercase tracking-[0.14em]',
```

Note the lens itself keeps `rounded-full` — that is the allowlisted case.

- [ ] **Step 3: Convert `StatusPill` and `Badge`**

Both are chips. In each file: remove `rounded-full` / `rounded-*`, set the label to `font-mono text-2xs uppercase tracking-[0.14em]`, and repoint any dark fill per the Task 2 triage table (`Badge.tsx:22`'s `bg-ink-800` is a dark **badge**, so it becomes `bg-action text-[rgb(var(--action-contrast-rgb))]`).

Keep every variant name and prop signature exactly as-is.

- [ ] **Step 4: Verify**

```bash
npm run guards            # expect clean — StatusLamp's hex is now gone
npx tsc --noEmit
npx eslint .              # 1 error, 34 warnings
npm run build
```

- [ ] **Step 5: Screenshot the lamps in both themes**

Re-shoot `/_tokens` (light and dark) and confirm: lamp cores identical between themes, lamp text legible on both bone and near-black, washes tinted rather than glowing, chips square, lens still circular.

- [ ] **Step 6: Commit**

```bash
git add src/components/StatusLamp.tsx src/components/StatusPill.tsx src/components/Badge.tsx src/app/globals.css
git commit -m "feat(dashboard): theme-aware lamps, square status chips

Lamp cores hold across themes; text weights and washes flip so they stay
legible on near-black instead of glowing. Lens structure is untouched —
the three states still differ by brightness and structure, not hue alone.
Chips lose their radius and take the mono micro-label treatment."
```

---

## Task 5: Shell and navigation

**Files:**
- Create: `dashboard/src/components/ThemeToggle.tsx`
- Modify: `dashboard/src/components/Sidebar.tsx`
- Modify: `dashboard/src/components/PageHeader.tsx`
- Modify: `dashboard/src/components/Tabs.tsx`

**Interfaces:**
- Consumes: `surface-dark`, `text-on-dark*`, `action`, `scrim` from Task 1.
- Produces: `<ThemeToggle />` — no props. Owns the `gravvia_theme` localStorage key and the `data-theme` attribute on `<html>`. The key name must match the `THEME_BOOT` script in `layout.tsx` exactly.

- [ ] **Step 1: Write the theme toggle**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

/**
 * Light/dark control.
 *
 * The key here MUST match the pre-paint THEME_BOOT script in layout.tsx.
 * That script is what prevents a bone flash on every dark-mode load; this
 * component only handles the change after the page is alive.
 *
 * Default is light — the marketing site's world, which is the point of
 * the whole facelift.
 */
const KEY = 'gravvia_theme';

export function ThemeToggle() {
  // Starts null so the first render matches what the boot script already
  // painted; reading localStorage during render would desync hydration.
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem(KEY) : null;
    setTheme(stored === 'dark' ? 'dark' : 'light');
  }, []);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(KEY, next); } catch { /* private mode */ }
  };

  const dark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 font-mono text-2xs uppercase tracking-[0.16em] text-text-on-dark-muted transition-colors duration-150 hover:bg-white/[0.05] hover:text-text-on-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
    >
      {dark
        ? <Sun className="h-[18px] w-[18px] flex-shrink-0" aria-hidden strokeWidth={1.75} />
        : <Moon className="h-[18px] w-[18px] flex-shrink-0" aria-hidden strokeWidth={1.75} />}
      <span className="flex-1 text-left">{dark ? 'Light' : 'Dark'}</span>
    </button>
  );
}
```

- [ ] **Step 2: Convert the nav rail**

In `Sidebar.tsx`, inside `NavRail`:

- Root wrapper: `bg-ink-900 text-panel-300` → `bg-surface-dark text-text-on-dark-secondary`.
- Identity block: `text-white` stays (it sits on a dark surface in both themes). `text-panel-400` → `text-text-on-dark-muted`.
- Group headings: `text-panel-400` → `text-text-on-dark-muted`, and add `font-mono tracking-[0.16em]` — the site's section-note treatment.
- **Active row** — replace the `shadow-seat` depressed-key look, which has no meaning in a flat world, with a cobalt edge:

```tsx
                        active
                          // A lit cobalt edge: the rail's one piece of chroma,
                          // and it means "you are here", which is an action
                          // relationship, not a status.
                          ? 'border-l-2 border-action bg-action-100 pl-[10px] font-medium text-action'
                          : 'border-l-2 border-transparent pl-[10px] font-normal text-text-on-dark-muted hover:bg-white/[0.05] hover:text-text-on-dark'
```

Keep `px-3 py-3` elsewhere in the class string, and note the left padding is now carried by `pl-[10px]` so the 2px border does not shift the row. Remove `rounded-md`.

- Active icon: `text-white` → `text-action`.
- Mobile bar and mobile rail wrappers: `bg-ink-900` → `bg-surface-dark`; the backdrop `bg-ink-900/60` → `bg-scrim`.
- Sign-out: `hover:bg-lamp-bad/[0.14] hover:text-lamp-bad-rim` stays — that is status chroma doing status work.
- Borders `border-white/[0.07]` stay; they sit on a permanently dark surface.

- [ ] **Step 3: Mount the toggle**

In the "Operator" footer block of `NavRail`, above the sign-out button:

```tsx
        <ThemeToggle />
```

Import it: `import { ThemeToggle } from '@/components/ThemeToggle';`

- [ ] **Step 4: Give `PageHeader` its mono eyebrow**

This reverses the rule in `globals.css` that said `.label-instrument` is *"never an eyebrow above a page heading"*. The transplant wins; the comment was already updated in Task 1.

Add an optional prop and render it. The prop is optional so all ~31 existing call sites keep compiling unchanged:

```tsx
interface PageHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
  breadcrumbs?: Array<{ label: string; href?: string }>;
  /** Mono micro-label above the title — the site's `.kicker`. */
  eyebrow?: string;
}
```

```tsx
export function PageHeader({ title, description, action, breadcrumbs, eyebrow }: PageHeaderProps) {
```

Inside the title block, above the `<h1>`:

```tsx
          {eyebrow && <p className="label-instrument mb-2">{eyebrow}</p>}
```

And retune the heading and body to the new type rules:

```tsx
          <h1 className="font-heading text-2xl font-medium tracking-[-0.02em] text-text">
            {title}
          </h1>
          {description && (
            <p className="mt-1.5 max-w-[68ch] text-sm leading-relaxed text-text-secondary">
              {description}
            </p>
          )}
```

Breadcrumb links: `text-panel-600` → `text-text-secondary`, `decoration-panel-300` → `decoration-hairline`, hover to `text-action`.

- [ ] **Step 5: Convert `Tabs`**

Underline tabs with a 2px cobalt active rule and mono labels. Keep every prop signature.

```tsx
        active
          ? 'border-b-2 border-action font-mono text-2xs uppercase tracking-[0.16em] text-action'
          : 'border-b-2 border-transparent font-mono text-2xs uppercase tracking-[0.16em] text-text-muted hover:text-text hover:border-rule'
```

- [ ] **Step 6: Verify**

```bash
npm run guards && npx tsc --noEmit && npx eslint . && npm run build
```

- [ ] **Step 7: Verify the theme switch end to end**

```bash
npm run dev &
```

By hand in a real browser at `http://localhost:3000/login` then `/dashboard`:
1. Toggle to dark. Confirm the rail, body, cards, and text all flip.
2. **Hard-reload.** There must be **no bone flash** — that is the FOUC script doing its job.
3. Confirm no React hydration warning in the console.
4. Toggle back to light and reload again.

If a flash appears, the `THEME_BOOT` key does not match `ThemeToggle`'s `KEY`.

- [ ] **Step 8: Commit**

```bash
git add src/components/ThemeToggle.tsx src/components/Sidebar.tsx src/components/PageHeader.tsx src/components/Tabs.tsx
git commit -m "feat(dashboard): cobalt rail, theme toggle, mono eyebrows

Nav rail moves to surface-dark so it stays dark under the inverted
neutral ramp. Active row becomes a cobalt left edge, replacing the
depressed-key shadow that has no meaning in a flat world.

PageHeader gains an optional mono eyebrow, deliberately reversing the
previous 'never an eyebrow' rule — the marketing site uses them
throughout. Optional, so all existing call sites compile unchanged."
```

---

## Task 6: Overlays

**Files:**
- Modify: `dashboard/src/components/Drawer.tsx`
- Modify: `dashboard/src/components/ConfirmDialog.tsx`

**Interfaces:**
- Consumes: `scrim`, `surface-raised`, `edge`, `shadow-xl` from Task 1.
- Produces: unchanged public APIs.

Floating layers are the **only** things allowed a shadow, and it is the ink hard offset — never cobalt, which is reserved for interactive lift.

- [ ] **Step 1: Convert `Drawer`**

- Backdrop: `bg-ink-900/60` (line ~79) → `bg-scrim`.
- Panel: `bg-white` was already swept to `bg-surface-raised` in Task 2. Add the edge and offset: `border-l border-edge shadow-xl`.
- Remove any `rounded-*` (already stripped in Task 2 — confirm none returned).
- Header/close button colours: `text-panel-500` → `text-text-muted`, hover `text-text`.

- [ ] **Step 2: Convert `ConfirmDialog`**

- Backdrop → `bg-scrim`.
- Dialog panel → `border border-edge bg-surface-raised shadow-xl`.
- Destructive confirm button (line ~158): `bg-lamp-bad-ink hover:bg-[#8d1811]` → `bg-lamp-bad-ink hover:bg-lamp-bad` (the arbitrary hex was retired in Task 2 — confirm).
- Neutral/cancel button: `border border-rule hover:border-action hover:text-action`.
- The default confirm button `bg-ink-800 hover:bg-ink-900` (line ~159) is an **action**: → `bg-action text-[rgb(var(--action-contrast-rgb))] hover:bg-action-800`.

A destructive button staying red is correct and does not break the colour rule: red here is reporting the *consequence* is bad, which is state. Cobalt is for the neutral action beside it.

- [ ] **Step 3: Verify**

```bash
npm run guards && npx tsc --noEmit && npx eslint . && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/components/Drawer.tsx src/components/ConfirmDialog.tsx
git commit -m "feat(dashboard): square overlays on ink hard offsets

Floating layers are the only things in this system that cast a shadow,
and it is the ink offset — cobalt is reserved for interactive lift."
```

---

## Task 7: Data primitives

**Files:**
- Modify: `dashboard/src/components/KPICard.tsx`
- Modify: `dashboard/src/components/Table.tsx`
- Modify: `dashboard/src/components/DataTable.tsx`

**Interfaces:**
- Consumes: `action-wash`, `action-rim`, `hairline`, `text-*` from Task 1.
- Produces: unchanged public APIs. `KPICardProps` keeps `label`, `value`, `icon`, `color`, `trend`, `trendLabel`, `subtitle` — `color` remains accepted and visually inert, exactly as today, so no call site changes.

These are the two ports that pay for the transplant.

- [ ] **Step 1: Port `KPICard` to the site's `.kpi`**

Replace the component body (keep the interface and imports):

```tsx
export function KPICard({ label, value, icon: Icon, trend, trendLabel, subtitle }: KPICardProps) {
  const rising = typeof trend === 'number' && trend >= 0;
  const Arrow = rising ? ArrowUpRight : ArrowDownRight;

  return (
    // The site's `.kpi`: a cobalt-rimmed well on a cobalt wash. The figure
    // is the subject; everything else is a label around it.
    <div
      className="group border bg-[var(--action-wash)] px-4 py-3"
      style={{ borderColor: 'var(--action-rim)' }}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-3 w-3 flex-shrink-0 text-text-muted" aria-hidden strokeWidth={1.75} />
        <p className="truncate font-mono text-2xs uppercase tracking-[0.16em] text-text-muted">
          {label}
        </p>
      </div>

      <p data-numeric className="mt-2 font-heading text-3xl font-medium tracking-[-0.022em] text-text">
        {value}
      </p>

      {(trend !== undefined || trendLabel || subtitle) && (
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {trend !== undefined && (
            <span
              data-numeric
              className={clsx(
                'inline-flex items-baseline gap-0.5 font-mono text-2xs font-medium',
                rising ? 'text-lamp-good-ink' : 'text-lamp-bad-ink'
              )}
            >
              <Arrow className="h-3 w-3 self-center" aria-hidden strokeWidth={2.25} />
              {Math.abs(trend)}%
            </span>
          )}
          {(trendLabel || subtitle) && (
            <span className="truncate text-xs text-text-muted">{trendLabel ?? subtitle}</span>
          )}
        </div>
      )}
    </div>
  );
}
```

Update the docblock: the old one says *"`color` no longer tints the cell, because chroma on this surface is reserved for status."* That reason is retired. Replace with: *"`color` remains accepted and inert; the cell's chroma is the cobalt wash, which means 'this is a readout you can open', not a status."*

- [ ] **Step 2: Port the table heads to the site's `.log`**

In both `Table.tsx` and `DataTable.tsx`, the `<th>` class becomes:

```tsx
'border-b border-rule px-4 py-2.5 text-left font-mono text-2xs uppercase tracking-[0.16em] text-text-muted'
```

Row separators go to `border-t border-hairline`. Row hover becomes the cobalt wash:

```tsx
'transition-colors duration-120 hover:bg-[var(--action-wash)]'
```

Container: `border border-hairline bg-surface-raised` — no shadow.

Keep `tabular-nums` behaviour intact; `globals.css` already applies it to `table` elements.

- [ ] **Step 3: Verify**

```bash
npm run guards && npx tsc --noEmit && npx eslint . && npm run build
```

- [ ] **Step 4: Screenshot a real table and a real KPI row**

```bash
npm run dev &
CH="/c/Program Files/Google/Chrome/Application/chrome.exe"
"$CH" --headless --disable-gpu --hide-scrollbars --window-size=1440,1600 \
  --screenshot="$SCRATCH/t7-calls-light.png" "http://localhost:3000/dashboard/calls"
```

Login is required for that route, so if the shot renders the login page instead, screenshot `/_tokens` and inspect the table by hand in a signed-in browser instead. Do not fake the verification.

- [ ] **Step 5: Commit**

```bash
git add src/components/KPICard.tsx src/components/Table.tsx src/components/DataTable.tsx
git commit -m "feat(dashboard): port KPI and table heads to the site's language

KPICard becomes the site's .kpi — cobalt-rimmed well on a cobalt wash,
mono key, figure as subject. Table heads take the mono uppercase
treatment and rows hover on the cobalt wash. Both keep their public APIs
so no call site changes."
```

---

## Task 8: Remaining form and utility components

**Files:**
- Modify: `dashboard/src/components/FilterBar.tsx`
- Modify: `dashboard/src/components/ClientPicker.tsx`
- Modify: `dashboard/src/components/InlineEditTable.tsx`
- Modify: `dashboard/src/components/TicketComposer.tsx`
- Modify: `dashboard/src/components/Hint.tsx`
- Modify: `dashboard/src/components/SlaCountdown.tsx`
- Modify: `dashboard/src/components/CopilotFaqs.tsx`

**Interfaces:**
- Consumes: all Task 1 tokens.
- Produces: unchanged public APIs across all seven.

Apply this mapping to each file. Radius and `bg-white` were already handled in Task 2, so this pass is colour semantics and the mono treatment.

| Current | Replace with | Why |
| --- | --- | --- |
| `text-panel-500` / `text-panel-600` | `text-text-muted` / `text-text-secondary` | Alpha-composited, so it holds on any surface. |
| `text-ink-900` / `text-ink-800` | `text-text` | One strongest-text token per theme. |
| `border-panel-200` / `border-panel-300` | `border-hairline` / `border-rule` | Two rule weights, named. |
| `focus:ring-signal-600` / `focus:border-signal-600` | `focus:ring-action` / `focus:border-action` | Inert alias, but leaves the retired name in the source. |
| `bg-ink-800 hover:bg-ink-900` on a **button** | `bg-action text-[rgb(var(--action-contrast-rgb))] hover:bg-action-800` | Actions are cobalt now. |
| any field/column label | add `font-mono text-2xs uppercase tracking-[0.16em]` | The site's micro-label. |
| any clickable card | add `lift` | The physical press the hard shadow implies. |

Primary buttons additionally take the site's **hover inversion**:

```tsx
'border border-action bg-action px-4 py-2.5 text-sm font-medium text-[rgb(var(--action-contrast-rgb))] transition-colors duration-150 hover:bg-transparent hover:text-action'
```

- [ ] **Step 1: Work through the seven files applying the table above**

Worked example — `FilterBar.tsx`'s select control becomes:

```tsx
        className="border border-rule bg-surface-raised px-3 py-2 text-sm text-text transition-colors duration-150 hover:border-action focus:border-action focus:outline-none focus:ring-2 focus:ring-action/25"
```

and its label:

```tsx
        <span className="font-mono text-2xs uppercase tracking-[0.16em] text-text-muted">{label}</span>
```

- [ ] **Step 2: Confirm nothing references a retired name**

```bash
grep -rn -E "\b(signal|panel|ink|navy|gray)-[0-9]+" src/components
```

Hits are not errors — the aliases still resolve — but every hit in these seven files should have been converted. Anything left is an oversight; fix it.

- [ ] **Step 3: Verify**

```bash
npm run guards && npx tsc --noEmit && npx eslint . && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/components
git commit -m "feat(dashboard): convert remaining shared components to tokens

Colour semantics and the mono micro-label treatment across FilterBar,
ClientPicker, InlineEditTable, TicketComposer, Hint, SlaCountdown, and
CopilotFaqs. Primary buttons take the site's hover inversion. All public
APIs unchanged."
```

---

## Task 9: Charts

**Files:**
- Modify: `dashboard/src/components/charts/ChartCard.tsx`
- Modify: `dashboard/src/components/charts/VolumeChart.tsx`
- Modify: `dashboard/src/components/charts/OutcomeChart.tsx`

**Interfaces:**
- Consumes: the theme-aware `.viz-root` block from Task 1 Step 2.
- Produces: unchanged public APIs. `VolumeChart({ data, bucket })` with `VolumePoint { bucket, answered, voicemail, total }`. `OutcomeChart`'s existing props are unchanged.

Series identity is cobalt + ink at stepped opacity, separated by **fill texture**, not by a second hue.

- [ ] **Step 1: Add a hatch pattern to `VolumeChart`**

The second series is distinguished by texture so identity never rests on colour alone. Inside the `<AreaChart>`'s `<defs>`, replace the two gradients:

```tsx
          <defs>
            {/* Series 1: solid cobalt wash. */}
            <linearGradient id="fill-answered" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.20} />
              <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0.05} />
            </linearGradient>
            {/* Series 2: hatched ink. Texture, not hue, carries the
                difference — which is what makes this pair CVD-safe. */}
            <pattern id="fill-voicemail" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--series-2)" fillOpacity={0.06} />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--series-2)" strokeWidth="1.5" strokeOpacity={0.35} />
            </pattern>
          </defs>
```

Change the second `<Area>`'s fill to `fill="url(#fill-voicemail)"` — the id is unchanged, so no other edit is needed.

- [ ] **Step 2: Square the legend swatches and mirror the texture**

```tsx
      <div className="mb-3 flex flex-wrap items-center gap-4 font-mono text-2xs uppercase tracking-[0.16em] text-text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5" style={{ background: 'var(--series-1)' }} aria-hidden />
          Answered
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5"
            style={{
              backgroundColor: 'transparent',
              backgroundImage:
                'repeating-linear-gradient(45deg, var(--series-2) 0 1.5px, transparent 1.5px 4px)',
            }}
            aria-hidden
          />
          Voicemail
        </span>
      </div>
```

The legend stays mandatory. Identity is never colour-alone — that rule predates this change and survives it.

- [ ] **Step 3: Retune axes, grid, and tooltip**

```tsx
            tick={{ fill: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
```

on both `<XAxis>` and `<YAxis>`. And the tooltip:

```tsx
            contentStyle={{
              background: 'var(--surface-1)',
              border: '1px solid var(--baseline)',
              borderRadius: 0,
              fontSize: 12,
              color: 'rgb(var(--text-rgb))',
            }}
```

`borderRadius: 0` matters — recharts sets its own inline radius and Tailwind cannot reach it.

- [ ] **Step 4: Apply the same three changes to `OutcomeChart`**

Read the file first; it is a different chart form. Apply: square legend swatches, mono axis ticks at 11px, `borderRadius: 0` on the tooltip, series from `var(--series-1)` / `var(--series-2)`, and remove any `radius={[…]}` prop on `<Bar>` — bars are square in this world.

- [ ] **Step 5: Make sure every chart sits inside `.viz-root`**

`var(--series-1)` resolves to nothing outside that class and the marks render black.

```bash
grep -rn "viz-root" src/components/charts src/app/dashboard
```

Every route rendering a chart must have a `.viz-root` ancestor. `ChartCard` is the natural home — add `viz-root` to its outermost `className` so consumers get it automatically, and confirm the analytics page (fixed in Task 2 Step 7) is covered.

- [ ] **Step 6: Verify**

```bash
npm run guards && npx tsc --noEmit && npx eslint . && npm run build
```

- [ ] **Step 7: Screenshot both themes**

Charts are the most likely thing to look wrong in dark mode — recharts injects inline styles the token layer cannot reach. Shoot a chart-bearing route in both themes and check: axis text legible, gridlines visible but recessive, tooltip background not white-on-white, hatch pattern visible against the dark surface.

- [ ] **Step 8: Commit**

```bash
git add src/components/charts
git commit -m "feat(dashboard): two-colour charts, cobalt and hatched ink

Series identity is cobalt + ink at stepped opacity separated by fill
texture rather than a second hue. The site is a cobalt-and-ink binary
with no third colour, and texture-plus-luminance is CVD-safe by
construction — which retires the numeric CVD gate the previous
teal/mulberry pair was never run through."
```

---

## Task 10: Login page

**Files:**
- Modify: `dashboard/src/app/login/page.tsx`

**Interfaces:**
- Consumes: `StatusLamp` (Task 4), all Task 1 tokens.
- Produces: nothing consumed downstream.

**Do not reintroduce** "SOC 2-aligned", "Enterprise-grade security", or any claim the repository cannot substantiate. The prior build removed them deliberately. The signal chain stays — it describes a real mechanism.

- [ ] **Step 1: Add the cobalt grid to the dark aside**

The site's signature background. Add to the `<aside>`:

```tsx
      <aside
        className="relative hidden flex-col justify-between overflow-hidden bg-surface-dark px-12 py-11 lg:flex lg:w-[46%] xl:w-[48%]"
        style={{
          backgroundImage:
            'linear-gradient(var(--action-wash-2) 1px, transparent 1px), linear-gradient(90deg, var(--action-wash-2) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      >
```

- [ ] **Step 2: Retune the aside's type**

- Identity subtitle → `font-mono text-2xs uppercase tracking-[0.2em] text-text-on-dark-muted`.
- Headline → `font-heading text-4xl font-light leading-[1.06] tracking-[-0.026em] text-text-on-dark xl:text-5xl`. This is the one place the site's weight 300 belongs.
- Body → `text-sm leading-relaxed text-text-on-dark-secondary`.
- Chain stage name → keep `font-medium text-text-on-dark`; the verb → `text-text-on-dark-muted`; detail → `text-xs text-text-on-dark-muted`.
- The connecting line gradient `from-white/25 via-white/12` stays — it sits on a permanently dark surface.
- Footer line → `font-mono text-2xs uppercase tracking-[0.16em] text-text-on-dark-muted`.

- [ ] **Step 3: Move the form side onto bone**

- Root: `bg-white` → already `bg-surface-raised` from Task 2; change to `bg-surface` so it is the bone page, not a raised card.
- Heading: `text-2xl font-medium text-text`, with a mono eyebrow above it:

```tsx
            <p className="label-instrument mb-2">Operations console</p>
            <h1 className="font-heading text-2xl font-medium tracking-[-0.02em] text-text">
              Sign in
            </h1>
            <p className="mt-1.5 text-sm text-text-secondary">Access is provisioned by your administrator.</p>
```

(Delete the duplicate "Access is provisioned…" sentence from the footer block if you move it here, or keep the footer and leave the subtitle as "Operations console access." — do not print the same sentence twice.)

- Field labels → `mb-1.5 block font-mono text-2xs uppercase tracking-[0.16em] text-text-secondary`.
- Inputs → `w-full border border-rule bg-surface-raised px-3 py-2.5 text-sm text-text transition-colors duration-150 placeholder:text-text-muted hover:border-text-faint focus:border-action focus:outline-none focus:ring-2 focus:ring-action/25`.
- "Forgot password?" and "Request an account" → `text-action underline decoration-action/40 hover:decoration-action`.

- [ ] **Step 4: Give the submit button the site's `.btn` inversion**

```tsx
              className="group flex w-full cursor-pointer items-center justify-center gap-2 border border-action bg-action py-2.5 text-sm font-medium text-[rgb(var(--action-contrast-rgb))] transition-colors duration-150 ease-out hover:bg-transparent hover:text-action active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:border-rule disabled:bg-transparent disabled:text-text-muted"
```

The spinner's `border-white/35 border-t-white` must follow the button text, or it vanishes on hover:

```tsx
                    className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current/35 border-t-current"
```

- [ ] **Step 5: Error panel to lamp tokens**

```tsx
                className="flex items-start gap-2 border border-lamp-bad-rim bg-lamp-bad-wash px-3 py-2.5 text-xs leading-relaxed text-lamp-bad-ink"
```

- [ ] **Step 6: Verify**

```bash
npm run guards && npx tsc --noEmit && npx eslint . && npm run build
```

- [ ] **Step 7: Screenshot both themes**

```bash
npm run dev &
CH="/c/Program Files/Google/Chrome/Application/chrome.exe"
"$CH" --headless --disable-gpu --hide-scrollbars --window-size=1440,1200 \
  --screenshot="$SCRATCH/t10-login-light.png" "http://localhost:3000/login"
```

For dark, set `gravvia_theme=dark` in localStorage in a real browser and reload, or add `--user-data-dir` with a seeded profile. Confirm: no bone flash, grid visible but recessive, headline in weight 300, button inverts on hover, lamps in the chain still pulse and stagger.

Do not judge overflow from a window narrower than 500px — Windows clamps it and reports overflow that is not real.

- [ ] **Step 8: Commit**

```bash
git add src/app/login/page.tsx
git commit -m "feat(dashboard): login in the cobalt world

Cobalt grid on the dark aside, display weight 300 on the headline, mono
micro-labels, and the site's hover-inversion on the submit button. The
signal chain stays — it diagrams a real mechanism. No unsubstantiated
claims reintroduced."
```

---

## Task 11: Overview page

**Files:**
- Modify: `dashboard/src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `PageHeader` (Task 5, with `eyebrow`), `KPICard` (Task 7), `StatusLamp` / `LampStatus` (Task 4).
- Produces: nothing consumed downstream.

This file holds the **1 pre-existing lint error**. Fix it here; the error count must reach 0.

- [ ] **Step 1: Fix the `react-hooks/purity` error**

`src/app/dashboard/page.tsx:80` calls `Date.now()` during render:

```tsx
  const age = updatedAt ? Date.now() - updatedAt : null;
```

Reading the clock during render is impure — React may render at any time, and the value silently goes stale. Move it into state driven by an interval, which is also what makes the "read 30s ago" label actually tick:

```tsx
function LampField({ health, updatedAt, refreshing, onRefresh }: { /* …unchanged… */ }) {
  // The clock is state, not a render-time read. Reading Date.now() during
  // render is impure and leaves the age label frozen until the next
  // unrelated re-render.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const age = updatedAt ? now - updatedAt : null;
```

Add `useState` and `useEffect` to the existing `react` import if not already present.

`timeAgo(row.lastSeen)` in `WorstFirst` has the same impurity. Pass `now` down, or leave it — eslint only flags the one. Passing it down is correct and cheap:

```tsx
function WorstFirst({ rows, now }: { rows: GroupedRow[]; now: number }) {
```
and inside, `timeAgo(row.lastSeen, now)`; update `timeAgo` to `function timeAgo(iso: string, now: number)` and use `now` instead of `Date.now()`. Update both call sites and the `sinceLabel` usage accordingly.

- [ ] **Step 2: Give the page its eyebrow**

```tsx
      <PageHeader
        eyebrow="Platform console"
        title="Overview"
        /* …existing props unchanged… */
      />
```

- [ ] **Step 3: Rebuild the lamp field as a hard-ruled strip**

The container gains the full-ink outer edge — the site's `.device` — and the cells separate on hairlines:

```tsx
      <div className="grid grid-cols-1 border border-edge bg-surface-raised sm:grid-cols-3">
        {cells.map((cell, i) => (
          <Link
            key={cell.label}
            href={cell.href}
            className={[
              'group flex items-center gap-4 px-5 py-4 transition-colors duration-120 ease-out hover:bg-[var(--action-wash)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-action',
              i > 0 ? 'border-t border-hairline sm:border-l sm:border-t-0' : '',
            ].join(' ')}
          >
```

Cell internals:

```tsx
                <span data-numeric className="font-heading text-2xl font-medium tracking-[-0.02em] text-text">
                  {cell.count}
                </span>
                <span className="font-mono text-2xs uppercase tracking-[0.16em] text-text-muted">
                  {cell.label}
                </span>
              </span>
              <span className="mt-0.5 block truncate text-xs text-text-muted">{cell.hint}</span>
```

Section heading and staleness label:

```tsx
          <h2 id="health-heading" className="label-instrument">System state</h2>
          <span className={stale ? 'font-mono text-2xs uppercase tracking-[0.16em] text-lamp-fair-ink' : 'font-mono text-2xs uppercase tracking-[0.16em] text-text-muted'}>
```

Refresh button:

```tsx
            className="flex cursor-pointer items-center gap-1.5 border border-rule px-2.5 py-1.5 font-mono text-2xs uppercase tracking-[0.16em] text-text transition-colors duration-150 hover:border-action hover:text-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action disabled:opacity-60"
```

The lamps themselves and the `sr-only` status line are unchanged. **Do not** replace the real severity counts with anything static.

- [ ] **Step 4: Rebuild "Worst first" as the site's `.log`**

Tighter, mono, hairline-ruled — a genuine density gain over the current `py-3.5` list:

```tsx
        <ul className="border border-hairline bg-surface-raised">
          {rows.map((row, i) => (
            <li key={row.fingerprint} className={i > 0 ? 'border-t border-hairline' : ''}>
              <Link
                href="/dashboard/system"
                className="group flex items-start gap-3 px-4 py-2.5 transition-colors duration-120 ease-out hover:bg-[var(--action-wash)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-action"
              >
```

with the row's route and count in mono:

```tsx
                {row.route && (
                  <span className="hidden flex-shrink-0 font-mono text-2xs text-text-muted sm:block">
                    {row.route}
                  </span>
                )}
                <span data-numeric className="flex-shrink-0 border border-hairline px-1.5 py-0.5 font-mono text-2xs text-text-secondary">
                  &times;{row.count}
                </span>
```

Section heading → `className="label-instrument"`. The "Open System Health" link → `text-action underline decoration-action/40 hover:decoration-action`, in mono at `text-2xs uppercase tracking-[0.16em]`.

- [ ] **Step 5: Square the skeletons**

```tsx
      <div className="mb-6 h-8 w-56 animate-pulse bg-panel-200" />
      <div className="mb-7 h-[5.5rem] animate-pulse bg-panel-200" />
      <div className="mb-7 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse bg-panel-200" />
        ))}
      </div>
      <div className="h-56 animate-pulse bg-panel-200" />
```

`bg-panel-200` is theme-aware via the inverted ramp, so these are correct in dark mode without a variant.

- [ ] **Step 6: Convert `ClientSignposts`**

Each signpost is a clickable card, so it takes `lift`:

```tsx
          className="lift group block border border-hairline bg-surface-raised px-5 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
```

Label → `font-heading text-base font-medium text-text`; blurb → `mt-1 text-xs text-text-muted`.

- [ ] **Step 7: Verify — the error must be gone**

```bash
npm run guards            # clean
npx tsc --noEmit          # exit 0
npx eslint .              # expect: 0 errors, <= 34 warnings
npm run build             # exit 0
```

**If eslint still reports 1 error, Step 1 is incomplete.** Do not proceed.

- [ ] **Step 8: Screenshot both themes, signed in**

Sign in via a real browser, then shoot with a seeded profile, or take the screenshots manually. Confirm: hard-ruled lamp strip with the full-ink edge, `.kpi` wells, dense mono log, lamps unchanged in colour between themes, skeletons square.

- [ ] **Step 9: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "feat(dashboard): overview in the cobalt world

Lamp field becomes a hard-ruled strip on the full-ink edge; KPIs become
the site's .kpi wells; worst-first becomes the site's .log at real
density. Lamps still read live severity counts — nothing static.

Fixes the pre-existing react-hooks/purity error: Date.now() was read
during render, which also left the staleness label frozen until an
unrelated re-render. The clock is now state on a 1s interval."
```

---

## Task 12: Documentation and the Phase 1 gate

**Files:**
- Modify: `dashboard/DESIGN.md`
- Modify: `dashboard/src/app/_tokens/page.tsx` (final pass)

**Interfaces:**
- Consumes: everything.
- Produces: the artefacts the user reviews to approve or redirect Phase 2.

`DESIGN.md` currently documents the retired world — "chroma is reserved for state", achromatic affordance, teal signal, Archivo. Leaving it is worse than having no document: the next person will follow it.

- [ ] **Step 1: Rewrite `DESIGN.md`**

It must state, at minimum:
- The world: bone/ink/cobalt from `gravvia-site/assets/site.css`, DM Sans + DM Mono, radius 0, hard offsets only.
- **The rule:** cobalt means "you can act on this"; green/amber/red mean state; neither hue crosses. And that this *replaces* "chroma is reserved for state" — say so explicitly, with the reason (the original concern was that a lamp must never read as a control, and that concern is still met).
- The token architecture: raw hex lives only in the `:root` / `[data-theme="dark"]` blocks of `globals.css`; `tailwind.config.ts` holds only `var()` references; the neutral ramp inverts, which is what makes 294 legacy references theme-aware for free.
- The hazard that creates: a fill that must stay dark in both themes uses `surface-dark`, never `ink-900`.
- Charts are two-colour by construction, and why that retires the CVD gate.
- `npm run guards` exists, what its four rules are, and that it is the closest thing to a test in this workspace.
- What is **not** done: Phases 2 and 3 — 29 routes still inherit the primitives rather than being individually composed.

- [ ] **Step 2: Refresh the token sheet**

Add the now-real primitives to `/_tokens` so it reflects the built world rather than the base atoms: a `KPICard`, a `LampStatus` row, a `Tabs` strip, a small `Table`, and a `ChartCard`. Import the real components rather than re-drawing them — the sheet must not drift from what ships.

- [ ] **Step 3: Full verification sweep**

```bash
cd "C:/Users/VYRA/Desktop/Inbound Agent v4/dashboard"
npm run guards            # clean
npx tsc --noEmit          # exit 0
npx eslint .              # 0 errors, <= 34 warnings
npm run build             # exit 0
```

Record the actual numbers. Do not report a range or an estimate.

- [ ] **Step 4: Screenshot the full route set in both themes**

At minimum: `/login`, `/dashboard`, `/_tokens`, plus five routes never hand-touched in Phase 1 — `/dashboard/calls`, `/dashboard/clients`, `/dashboard/system`, `/dashboard/support`, `/dashboard/settings`. Those five are the real test of whether the config-layer conversion held.

Look specifically for:
- any surface that stayed light in dark mode (a missed `bg-white`, or an `ink-900` that should be `surface-dark`)
- any text that lost contrast against its surface
- any resurrected corner radius
- recharts tooltips rendering white-on-white in dark mode

- [ ] **Step 5: STOP — Phase 1 review gate**

Present to the user:
1. Both-theme screenshots of `/login`, `/dashboard`, and the five inherited routes.
2. The exact verification numbers from Step 3.
3. An honest list of anything that looks wrong in the inherited routes and is deferred to Phase 2/3.

Do not begin Phase 2. Its page list is re-decided after this gate.

- [ ] **Step 6: Commit**

```bash
git add DESIGN.md src/app/_tokens/page.tsx
git commit -m "docs(dashboard): DESIGN.md for the cobalt world

Replaces the retired supervisory-panel document, which described
achromatic affordance, a teal signal ramp, and 'chroma is reserved for
state' — all superseded. Records the new rule and its reason, the token
architecture, the dark-surface hazard the inverted ramp creates, and
what Phases 2-3 still owe."
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
| --- | --- |
| §1 goal, pilot-first rollout | Task 3 Step 4, Task 12 Step 5 (the two gates) |
| §2 the rule that changes | Task 1 Step 5 (config docblock), Task 12 Step 1 (DESIGN.md) |
| §2 mono-eyebrow reversal | Task 1 Step 3, Task 5 Step 4 |
| §3.1 CSS-var token layer | Task 1 Steps 1–2 |
| §3.2 semantic token names | Task 1 Step 1, Step 5 |
| §3.3 legacy preservation, all five counts | Task 1 Step 5 (config), Task 2 Steps 4–6 (sweeps) |
| §3.4 radius 0, hard offsets, borders, card fill | Task 1 Step 5, Task 2 Step 5, Task 6 |
| §3.5 DM type, body 400, mono micro-labels | Task 1 Step 6, applied Tasks 4–11 |
| §4 dark mode, toggle, default light, FOUC | Task 1 Step 6, Task 5 Steps 1/3/7 |
| §5 all 21 components | Tasks 4–9 |
| §5 StatusLamp survives structurally | Task 4 (explicit "do not flatten") |
| §6 two-colour charts | Task 9 |
| §7 motion, reduced-motion kept verbatim | Task 1 Step 4 |
| §8 login pilot | Task 10 |
| §8 overview pilot + lint error | Task 11 |
| §9 phases | Task 12 Step 5 |
| §10 verification, baseline, guards, screenshots | Global Constraints, Task 2, every task's verify step |
| §11 risks | Mitigations sit in the task that creates each risk (Task 1's inversion hazard → Task 2 Step 6) |

**Gaps found and closed during review:**
- The spec never mentioned `src/lib/design-tokens.ts`. Discovered during planning: dead, unimported, 42 stale hex values that would trip the hex guard. Added to Task 1 Step 7.
- The spec assumed the lint error would be fixed because Phase 1 rewrites its file. Verified: the error is real, is at `src/app/dashboard/page.tsx:80`, and is `react-hooks/purity`, not a formatting nit — it needs an actual fix, now written out in Task 11 Step 1.
- The spec did not anticipate that inverting the neutral ramp flips 53 deliberately-dark fills. Added as Task 2 Step 6 with a triage table.
- The spec did not note that `analytics/page.tsx` uses lamp-green `#40c057` as a chart series — a live violation of the colour rule. Added to Task 2 Step 7.
- DM Mono ships no weight 600, which the current `JetBrains_Mono` declaration requests. Called out in Task 1 Step 6.
- Tailwind opacity modifiers break on plain `var()` colours, and `Sidebar.tsx` uses `bg-lamp-bad/[0.14]`. Resolved with the RGB-triplet + `<alpha-value>` pattern in Task 1.

**Placeholder scan:** no TBD/TODO. Every code step carries real code. The one instruction that says "apply the table above to seven files" (Task 8) is accompanied by the complete mapping table and a worked example, which is the actual content needed.

**Type consistency:** `LampLevel` is `'good' | 'fair' | 'bad' | 'off'` in Tasks 3, 4, and 11. `KPICardProps` field names match between Task 7 and Task 11's usage. `PageHeaderProps.eyebrow` is defined in Task 5 and consumed in Tasks 10 and 11. The `gravvia_theme` localStorage key is identical in Task 1's `THEME_BOOT` and Task 5's `ThemeToggle.KEY` — Task 5 Step 7 verifies they match. `VolumePoint` is unchanged from the existing file. The `fill-voicemail` id is reused in Task 9 Step 1 so the `<Area>` reference needs no edit.
