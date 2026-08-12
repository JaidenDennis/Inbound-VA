# Dashboard Cobalt Facelift — Design

**Date:** 2026-08-11
**Branch:** `feat/dashboard-cobalt-facelift` (off `main` @ `3bc78db`)
**Scope:** `dashboard/` workspace only. No backend changes.

---

## 1. Goal

Replace the Gravvia Engage dashboard's visual language with the one already
shipped on the marketing site, so a customer who reads gravvia.com and then logs
in is standing in the same building.

The user chose a **full brand transplant**, not a refinement, and asked for four
additions on top of it:

1. Layout and density rework (not a reskin)
2. Motion and interaction polish
3. Charts and data-viz rework
4. Dark mode

Rollout is **pilot-first**: build the token layer and shared primitives, hand-finish
two pages, review live, then roll.

### Source of truth for the visual language

`C:\Users\VYRA\Desktop\gravvia-site\assets\site.css` — the live site's real CSS.
Not the `.dc.html` design-canvas prototypes, which do not run as-is.

Values taken from it:

| Token | Value |
| --- | --- |
| bone (page) | `#f0f0ee` |
| ink (text/rules) | `#030303` |
| cobalt (action) | `#1d4fd8` |
| cobalt-lt (cobalt on dark) | `#8aa4ff` |
| dark panel | `#030303`, inset `#0c0c0c` |
| bone alphas on dark | 75 / 60 / 55 / 28 / 22 % |
| ink alphas on bone | 70 / 55 / 40 / 22 / 12 / 6 % |
| type | DM Sans + DM Mono |
| radius | `0` everywhere except dots |
| shadow | hard offsets only, no blur |

---

## 2. What this replaces, and the rule that changes

The dashboard's current world is the deliberate 2026-08-07 revamp, documented in
`dashboard/DESIGN.md`. Its load-bearing rule:

> **Chroma is reserved for state.** Green, amber, and red mean good/fair/bad and
> nothing else may use them — which is *why* interactive affordance is achromatic
> graphite rather than a brand colour.

Introducing cobalt as the action colour ends that rule. It is replaced with one
that preserves its actual value:

> **Cobalt means "you can act on this." Green / amber / red mean state.
> Neither hue ever crosses into the other's job.**

A lit lamp still can never be mistaken for a control, and a control still can
never be mistaken for a healthy row — the original concern — while the product
gains the brand colour. Blue is not a status hue in this system, so cobalt does
not collide with any lamp.

**Consequence:** the existing teal `signal` ramp is retired. Cobalt takes its
role (focus rings, links, selection, accent) *and* the primary-action role that
`ink` currently holds.

### One documented rule is deliberately reversed

`dashboard/src/app/globals.css` states that `.label-instrument` is for column
heads and field labels, *"never as an eyebrow above a page heading."* The site
uses mono eyebrows throughout (`.kicker`, `.sec-note`). The transplant wins;
`PageHeader` gains a mono eyebrow. Recorded here so it reads as a decision, not
an oversight.

---

## 3. Token architecture

### 3.1 Why the config is rebuilt rather than extended

`dashboard/tailwind.config.ts` hardcodes hex values. Dark mode via `dark:`
variants would mean touching all 69 `.tsx` files. Instead:

**The Tailwind palette becomes CSS-variable-backed semantic tokens.**

- Variables defined once on `:root` (light) and once on `[data-theme="dark"]`.
- Tailwind colours reference `var(--…)`.
- Theme switching is one attribute on `<html>`. No per-component work.

**Where the values live.** All raw hex is confined to one file,
`dashboard/src/app/globals.css`, in the `:root` and `[data-theme="dark"]`
blocks. Nothing else under `dashboard/src` may contain a hex literal — enforced
by a grep guard (§10). `tailwind.config.ts` carries only `var(--…)` references
plus the structural scales (radius, type, shadow geometry).

Precedent already exists in this codebase: the `.viz-root` block in
`globals.css` already serves chart colours as CSS variables (`--series-1`,
`--gridline`, `--surface-1`, `--baseline`, `--text-muted`). This extends that
pattern to the whole surface rather than inventing one.

### 3.2 Semantic token names

Structural tokens (theme-aware):

```
--surface        page background            bone / #030303
--surface-raised card fill                  #fbfbfa / #0c0c0c
--surface-inset  wells, code, table stripe
--text           primary text               ink / bone
--text-secondary
--text-muted
--hairline       12% rule
--rule           22% rule
--edge           full-strength container edge
--action         cobalt / cobalt-lt
--action-wash    cobalt 6%
--action-rim     cobalt 35%
--action-contrast text on a cobalt fill
```

Lamp tokens gain dark variants. Today's `-wash` / `-rim` values are light-only
tints and would glow on `#030303`.

### 3.3 Legacy name preservation (critical)

The 2026-08-07 revamp's second rule — *"names are preserved, values are
replaced"* — is the only reason the ~20 routes that were never hand-revised look
coherent. It is reused here. Measured counts in `dashboard/src`:

| Reference | Count | Handling |
| --- | --- | --- |
| `rounded-*` | 335 | Set every named step in the Tailwind `borderRadius` scale to `0` except `full`. Zero file edits; dots keep `rounded-full`. |
| `signal-*` | 199 | Repoint the `signal` ramp to cobalt in config. Correct in place. |
| `primary` / `navy` / `gray` / `blue` / `emerald` `-*` | 294 | Repoint at the new CSS vars. `blue: signal` stops being a lie — blue *is* the brand now. |
| `bg-white` | 145 | **The one real sweep.** → `bg-surface`. |
| `text-white` | 51 | **Left alone.** Only ever sits on dark fills, which stay dark in both themes. |

`white` is **not** overridden in config. Remapping it would make card text
invisible in dark mode.

### 3.4 Form

- **Radius `0`** on every named step except `full`. Chips, pills, avatars, inputs
  become rectangles. Lamps and dots stay circular, per the site handoff
  (*"corners are 0 everywhere except dots"*).
- **Shadows are hard offsets, no blur.** Exactly two exist:
  - **cobalt offset, 6px** — lifted interactive cards. Scaled down from the site's
    10/14px, which is sized for six marketing panels, not a dense grid.
  - **ink offset** — genuinely floating layers only (drawer, modal, menu, toast).
  - Everything else is hairline-only. No card shadows.
- **Borders.** The site draws every card at full 1px `#030303`. At console density
  that is a cage. Structure uses ink at **12% / 22%**; full-ink 1px is reserved
  for the outermost container edge and the site's `.device` treatment.
- **Card fill** is a half-step lift off bone (`#fbfbfa`), not white. Separation is
  by rule, not by brightness.

### 3.5 Type

DM Sans + DM Mono replace Archivo + JetBrains Mono in `layout.tsx`.

- Body weight **400**. The site's 300 is unreadable at 13px.
- Weight 300 reserved for display sizes ≥ 25px.
- Headings 500, `-0.02em`.
- **Mono takes over every micro-label**: uppercase, 9–11px, `.16–.24em` tracking.
  This is the site's most recognisable trait and maps exactly onto column heads,
  KPI labels, and status keys.
- The existing `fontSize` scale is kept — it is tuned for density. Tracking is
  retuned for DM Sans.
- `font-variant-numeric: tabular-nums` on figures stays. Highest-value type
  setting in the product.

---

## 4. Dark mode

- **Toggle in the UI, remembered.** Control in the sidebar footer. Persisted to
  `localStorage`. No backend change.
- **Default is light bone**, matching the marketing site.
- Values from the site's dark sections: `#030303` body, `#0c0c0c` inset, bone at
  75/60/55/28/22%, `#8aa4ff` for cobalt that stays readable on dark.
- **FOUC is the one thing that reliably breaks.** An inline script in
  `layout.tsx` sets `data-theme` on `<html>` from `localStorage` **before first
  paint**, and updates `color-scheme` so scrollbars and native form controls
  follow.
- Theme switch is an **instant swap, no cross-fade**. A fading dashboard reads as
  a bug.

---

## 5. Components

21 units: 18 in `dashboard/src/components`, 3 under `components/charts`.

### Near-1:1 ports from the site

- **`KPICard`** → the site's `.kpi`: 1px `cobalt-35` border, `cobalt-06` fill,
  mono 8px uppercase key, large value, cobalt for the featured figure. Props stay
  unchanged so existing routes keep working (`icon` and `color` remain accepted
  and remain visually inert, as today).
- **`Table` / `DataTable`** → column heads take the site's mono uppercase
  treatment; square; hairline rules; row hover is a `cobalt-06` wash.

### Structural rework

- **`Sidebar`.** The rail stays near-black in *light* mode — bone body beside a
  `#030303` panel is the site's actual composition, not a leftover. In dark mode
  it inverts to `#0c0c0c` against a `#030303` body. Active row becomes a 2px
  cobalt left edge + `cobalt-10` fill + `cobalt-lt` label, replacing
  `shadow-seat`. Gains the theme toggle in its footer.
- **`PageHeader`.** Gains the mono eyebrow (see §2).
- **`Tabs`.** Underline tabs, 2px cobalt active rule, mono labels.
- **`Drawer`, `ConfirmDialog`.** Square, hard ink offset.
- **`Badge`, `StatusPill`.** Rectangles, mono uppercase.

### Survives structurally

- **`StatusLamp`.** Already accessible done right — the three states differ in
  lens structure and brightness, not only hue, and a lamp without a visible word
  carries an `sr-only` one. **Do not flatten the lens.** It only loses radius on
  the seated chip and gains dark-mode `wash` / `rim` values.

### Token + form pass only

`FilterBar`, `ClientPicker`, `InlineEditTable`, `TicketComposer`, `Hint`,
`SlaCountdown`, `CopilotFaqs`, `ChartCard`.

---

## 6. Charts

**Series identity goes two-colour: cobalt + ink at stepped opacity, separated by
fill texture (solid vs. hatched), not by a second hue.**

Rationale:

- The site is a cobalt-and-ink binary. It has no third hue. Inventing one is
  off-language and risks landing near a lamp.
- It is CVD-safe by construction — luminance and texture carry identity, not hue.
- It retires an open problem. `globals.css` annotates the current `--series-1` /
  `--series-2` pair: *"these two slots have NOT been re-run through the numeric
  CVD/contrast gate… reasoned, not measured."* Two-colour removes the need for
  that gate.

Unchanged: legends are mandatory for ≥2 series; identity is never colour-alone;
legend text stays in an ink token, never the series colour; axis labels move to
mono. `--gridline`, `--baseline`, `--surface-1`, `--text-muted` become
theme-aware.

Affected: `ChartCard`, `VolumeChart`, `OutcomeChart`, and the Analytics /
Business / Reports / Stats routes that consume them.

---

## 7. Motion

**Keep the existing reduced-motion policy in `globals.css` verbatim.** It caps
transitions at 90ms rather than deleting them, deliberately, so hover / focus /
state feedback survives while decorative entrances and the looping lamp breath
stop. That reasoning is sound and is not revisited.

New motion is limited to what the hard shadow already implies physically:

| Interaction | Behaviour |
| --- | --- |
| Interactive card hover | `translateY(-2px)`, cobalt offset appears, 150ms `cubic-bezier(.16,1,.3,1)` |
| Press | offset collapses to 2px |
| Table row hover | `cobalt-06` wash, 120ms |
| Primary button hover | the site's `.btn` **inversion** — cobalt fill → transparent with cobalt text |
| Page entrance | existing `.animate-rise`, unchanged |
| Theme switch | instant, no transition |
| Nav active change | instant, no slide |

---

## 8. Pilot pages

### `login/page.tsx`

- Dark left panel stays. Gains the site's cobalt grid background
  (`linear-gradient(cobalt-10 1px, transparent 1px)` both axes), mono kickers,
  `cobalt-lt` accents.
- **The signal chain stays.** It is an honest diagram of a real mechanism
  (Retell talks → backend decides → database remembers → CRM displays), and the
  prior build deliberately stripped unsubstantiated claims from this page
  ("SOC 2-aligned", "Enterprise-grade security"). **None are reintroduced.**
- Right side moves off white onto bone. Square inputs, `ink-22` hairlines,
  cobalt focus.
- Submit becomes the site's `.btn` with its hover inversion.
- Display headline in DM Sans 300; the site's `h1 em::after` cobalt underline is
  available for the emphasised phrase.

### `dashboard/page.tsx` (Overview)

Density work, not a reskin:

- Mono eyebrow + title.
- **Lamp field** → hard-ruled strip, square, full-ink outer edge (the site's
  `.device` bar). Still lit by real `/system/activity/grouped` severity counts;
  no hardcoded "all systems green".
- **KPI row** → the site's `.kpi` grid, tightened.
- **"Worst first"** → the site's `.log` treatment: mono, hairline top rules,
  tighter leading. A genuine density gain over today's `py-3.5` list.
- **Skeletons** → square, bone tones. Left rounded they read as leftovers from
  the old world.
- The **1 pre-existing lint error** lives in this file. Fixed here, not carried.

---

## 9. Phases

**Phase 1 — the world + pilot.** Token layer, theme switch + FOUC script, token
sheet, 21 components, Login, Overview.

> **Token sheet** = a single throwaway static page at
> `dashboard/src/app/_tokens/page.tsx` rendering every primitive (buttons,
> inputs, lamps in all four levels, badges, tabs, table head + rows, KPI, card,
> drawer, chart swatches) against both themes, screenshotted headlessly and
> shown to the user **before any page work begins**. It is cheap to change;
> rebuilding 21 primitives is not. Deleted at the end of Phase 3.
→ **Review gate.** User views live and approves or redirects.

All 31 routes already look new after Phase 1 via inherited primitives — just not
individually composed.

**Phase 2 — daily drivers.** Calls, Call detail, Work Queue, Clients, Support,
Business.

**Phase 3 — remaining routes and chart-heavy pages.**

Phase 2's page list is re-decided *after* the Phase 1 gate. Seeing the world
built will change which pages matter.

---

## 10. Verification

**Constraint: the `dashboard/` workspace has no test tooling.** No vitest, no
jest, no testing-library, zero test files. Adding a test stack is out of scope
for a visual change.

The gate is:

```
npx tsc --noEmit
npm run build
npx eslint .
```

**Baseline to beat:** 1 pre-existing error (`dashboard/src/app/dashboard/page.tsx`)
+ 34 warnings. The error is fixed in Phase 1; warnings must not increase.

**Screenshots:** headless `chrome.exe`. There is no Chrome extension available on
this machine. The Windows 500px min-width clamp fakes horizontal overflow, so
narrow-viewport shots cannot be trusted for overflow verdicts.

**Grep guards**, run as part of the gate, to partly cover for the absent tests:

- no `rounded-` outside the dot allowlist (`rounded-full` on lamps/dots)
- no surviving teal hex (`#1E7A90`, `#0B6E7F`, …)
- no `bg-white`
- no hex literal anywhere under `dashboard/src` except in the `:root` /
  `[data-theme="dark"]` blocks of `globals.css`

**Both themes** are checked for every screenshot.

---

## 11. Risks

| Risk | Mitigation |
| --- | --- |
| Deleting legacy colour aliases flattens ~20 never-revised routes | Preserve every legacy name; replace only its value. This is the documented reason those routes still cohere. |
| Radius-0 by config silently squares something that needed a curve | Lamps/dots keep `rounded-full`; token sheet reviewed before page work. |
| Dark mode misses hardcoded colours | Grep guard for raw hex outside the token file. |
| Theme flash on load | Inline pre-paint script in `layout.tsx`. |
| Full-ink borders at table density read as a cage | Structure at 12%/22%; full ink only on the outer edge. |
| Site's 300 body weight illegible at 13px | Body 400; 300 only ≥25px. |
| Two-colour charts insufficient for a future 3+ series chart | Accepted. If a third slot is ever needed it must go through the numeric CVD gate that the current pair never passed. |
| No tests | Typecheck + build + lint + grep guards + two-theme screenshots. Stated plainly, not papered over. |

---

## 12. Out of scope

- Backend changes of any kind.
- The Analytics cross-company clusters work (tracked separately — the Business
  clusters are per-tenant by construction and need migration 033+).
- Adding a test stack to `dashboard/`.
- Any change to `gravvia-site`.
