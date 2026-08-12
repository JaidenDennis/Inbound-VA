# Design

Recorded from the built world, not from intention. Where this file and the code
disagree, the code is right and this file is stale.

This document replaces the previous `DESIGN.md`, which described a different,
now-retired world: an achromatic "supervisory panel" with a teal `signal`
accent, Archivo type, and 12px-radius cards. None of that survives in the
current code. That document was left in place through most of Phase 1 while
the world it described was being replaced underneath it — if you read an
earlier copy, or a summary that quotes "chroma is reserved for state" or
"signal-600" or "Archivo", it is describing the retired system, not this one.

## The world

**A brand transplant from the shipped marketing site**, not a new visual
identity invented for the console. `gravvia-site/assets/site.css` is the
source of truth for every raw colour value in this document; the dashboard's
`globals.css` token layer was built by lifting those values, not by picking
new ones.

Three colours, used almost exclusively:

| Role | Token | Value |
|---|---|---|
| Ground | `bone` | `#f0f0ee` |
| Ink | `ink` | `#030303` |
| Action | `cobalt` | `#1d4fd8` |

Type is **DM Sans** (`--font-sans`, UI and display) and **DM Mono**
(`--font-mono`, every micro-label and every figure) — both pulled from the
marketing site, replacing the previous Archivo/JetBrains Mono pair.

**Radius is `0` everywhere** except things that are structurally round: lamp
dots and `rounded-full` pills. `tailwind.config.ts` maps every named radius
step (`sm` through `3xl`) to `0`, so all pre-existing `rounded-*` classes in
untouched files go square with zero file edits — only `rounded-full` survives,
by an explicit exception (see `ROUND_ALLOWED` in the guards script below).

**Shadows are hard offsets only** — `Npx Npx 0 0 <color>`, no blur, no
zero-offset halos. `boxShadow.cobalt` (`6px 6px 0 0` cobalt) is the signature
"lift" effect on hover; the inherited `xs`..`xl` steps resolve to a soft ink
offset for genuinely floating layers (drawer, dialog, toast). The previous
system's blurred "ghost card" shadow (1px border + soft shadow) is gone.

## The rule, and what it replaced

**Cobalt means "you can act on this." Green, amber, and red mean state.
Neither hue ever crosses into the other's job.**

Primary buttons, active nav, links, and focus rings are cobalt. Lamps —
`StatusLamp`, `StatusPill`, `SeverityPill`, `SyncBadge` — are the only things
on the surface allowed to be green, amber, or red, and they mean exactly
"good", "fair", "bad".

**This replaces the previous rule, which was the opposite: "chroma is
reserved for state," with interactive affordance built achromatic (graphite
ink) specifically so a call-to-action could never be misread as a healthy
lamp.** The swap is a real reversal, not a refinement, and it is worth being
explicit about why it is safe:

The original concern was never "interactive things must be colourless." It
was narrower — **a status lamp must never read as a control** (or the reverse:
a control must never read as a status lamp) — because an operator scanning a
dense field of lamps needs every lit light to mean "this line needs you," not
"this is also a button." That concern is fully preserved under the new rule.
Cobalt is not one of the three lamp hues and never appears as a lamp core;
green/amber/red never appear on a button, a link, or active nav. The two
palettes are disjoint by construction (`tailwind.config.ts`'s `lamp` object
and `action` object share no colour), so a lit lamp still always means state
and a cobalt element still always means "act here." What changed is only
*which* non-lamp hue carries affordance — graphite ink, then cobalt — not
whether affordance and state stay separated.

## Token architecture

**Raw hex exists in exactly one place: the `:root` and `[data-theme="dark"]`
blocks at the top of `src/app/globals.css`.** Every other file — components,
pages, and all of `tailwind.config.ts` — references a CSS custom property,
never a literal colour. `tailwind.config.ts`'s own docblock states this
directly: "This file contains NO colour values."

The mechanism (`c()` in `tailwind.config.ts`):

```ts
const c = (v: string) => `rgb(var(${v}) / <alpha-value>)`;
```

Every Tailwind colour resolves through this to `rgb(var(--some-rgb) /
<alpha-value>)`, which is why `bg-action/50` and similar opacity modifiers
work on tokens that are themselves indirections — the RGB triplet form
(`29 79 216`, not `#1d4fd8`) is what makes Tailwind's alpha-value substitution
possible at all. A `rgba(...)` value (used for a handful of pre-composited
tokens like `--text-secondary`) cannot take a Tailwind alpha modifier; those
are used only where no opacity modifier is ever applied to them.

That indirection is what makes dark mode a single `data-theme="dark"`
attribute on `<html>` instead of a `dark:` variant scattered across every
file. Two rules that flow from it:

1. **Names are preserved, values are replaced.** Legacy Tailwind class names
   from the previous system — `panel-*`, `signal-*`, `primary-*`, `navy-*`,
   `green-*`, `amber-*`, `red-*`, `emerald-*`, `yellow-*`, `brand-*`,
   `accent-*` — still work, because `tailwind.config.ts` maps every one of
   them onto the new token set (`signal` and `primary` and `blue` all resolve
   to `action`/cobalt now; `green`/`emerald` resolve to the good lamp; etc).
   This is the mechanism that makes **roughly 294 legacy colour class
   references across the codebase theme-aware for free**, without anyone
   touching the files that use them.
2. **The neutral ramp inverts between themes.** In `:root`, `--n-25-rgb` is
   the lightest step and `--n-950-rgb` is bone (`--n-950-rgb: var(--bone-rgb)`
   — i.e. the ramp still terminates at the light colour, just at the opposite
   numeric end from where you'd expect). In `[data-theme="dark"]`, the same
   twelve custom properties are reassigned so `--n-25-rgb` becomes the
   darkest step and `--n-950-rgb` becomes bone. A component that reads
   `bg-panel-900` gets near-black text-on-light in light mode and
   near-bone in dark mode — the ramp inverted under it without the component
   changing. This inversion is *why* rule 1 works: an old `bg-panel-800
   text-panel-100` pairing that was legible in the old light-only system
   stays legible in both themes, because both halves of the ramp moved
   together.

## The hazard the inversion creates

Inversion is only safe for fills that are *supposed* to flip with the theme.
**A surface that must stay dark in both themes — the nav rail is the
example — must use `surface-dark` (or `surface-dark-inset`), never
`ink-900` or a numbered `panel-*`/`n-*` step.** `ink-900` and the `n-*` ramp
are defined to invert across their full range; `surface-dark`
(`--surface-dark-rgb`) is defined to stay at the dark end of the range in
*both* blocks instead of crossing to a light value — `3 3 3` in `:root`,
`12 12 12` in `[data-theme="dark"]` (`globals.css:42` and `:113`) — which is
what "purpose-built to stay dark" actually means here: the two values are
different numbers, not an identical pinned constant, but neither one is ever
light, because "a dark panel beside a bone body" is the marketing site's
actual composition in both of its own themes. (A token that genuinely holds
the *same* value in both blocks does exist — `--tint-on-dark-rgb`, `255 255
255` in both `globals.css:62` and `:126` — see below; that is the one to
reach for when the point is theme-identity, not merely "stays dark.")

This is not a hypothetical. During Task 2's mechanical sweep converting the
old palette to the new token names, a regex meant to catch `bg-white`
(`\bbg-white\b`) also matched *inside* `bg-white/[0.05]` — the `/` reads as a
word boundary — and rewrote five nav-rail alpha tints in `Sidebar.tsx` (the
active-item highlight and two hover states) from `bg-white/[alpha]` to
`bg-surface-raised/[alpha]`. In light mode nothing looked wrong. In dark
mode, `--surface-raised-rgb` (`20 20 20`, a raised card colour) is close
enough to the rail's own `--surface-dark-rgb` (`12 12 12`) that the active-nav
highlight and both hover states became visually indistinguishable from the
rail itself — a real, invisible-in-dark-mode regression that every automated
gate (tsc, eslint, build, the guards script) passed clean, because nothing
about it is a type error, a lint violation, or a banned string.

The fix was a dedicated token, `--tint-on-dark-rgb` (`255 255 255` in *both*
theme blocks, exposed as `bg-tint-on-dark`), for exactly this situation: a
light-coloured tint painted onto a surface that is dark in both themes. Use
`bg-tint-on-dark/[alpha]`, not `bg-surface-raised/[alpha]` or
`bg-white/[alpha]`, whenever the base surface itself is `surface-dark`.

The general lesson: **before using a numbered neutral step or `ink-*` on a
surface, ask "should this get lighter in dark mode?" If the answer is no,
it is not a numbered-ramp token.**

## Charts are two-colour by construction

`.viz-root` (`globals.css`) defines exactly two series tokens:

```css
--series-1: rgb(var(--action-rgb));   /* cobalt, solid fill */
--series-2: var(--text-muted);        /* ink at reduced opacity, hatched */
```

`VolumeChart` and `OutcomeChart` distinguish their two series by **fill
texture (solid vs. diagonal hatch) and luminance, not by a second hue.** The
site itself is a cobalt-and-ink binary with no third brand colour; inventing
one for chart series risks landing inside the amber lamp's hue range (the
previous system's actual failure mode — see below) or otherwise smuggling a
non-lamp hue that a viewer could misread as status.

This is also why the two-colour, texture-differentiated approach **retires
the numeric colour-vision-deficiency (CVD) contrast gate** that the *previous*
teal (`#1E7A90`) / mulberry (`#9B4D93`) series pair was designed to need but,
per the project ledger, was never actually run through. Distinguishing series
by luminance and fill pattern rather than hue is CVD-safe by construction —
there is no hue discrimination required to tell the two series apart, so
there is no CVD gate left to fail or to skip.

## `npm run guards`

`scripts/design-guards.mjs` is **the closest thing this workspace has to a
test** — there is no test framework here by design (see Testing below), so
this script is what stands in for regression coverage on the visual system.
It walks every `.ts`/`.tsx`/`.css` file under `src/` and fails the run
(non-zero exit) if it finds any of four things:

1. **Hex outside the token layer** — any `#`-prefixed colour literal outside
   `src/app/globals.css`'s `:root`/`[data-theme="dark"]` blocks, with one
   named exception (`BrandingPanel.tsx`, where a hex value is *client data* —
   a colour picker's default/placeholder — not a design token).
2. **A resurrected corner radius** — any `rounded-*` class other than
   `rounded-full`.
3. **`bg-white`** — a Tailwind default colour, not a token, which does not
   follow the theme and will render as a literal white square in dark mode.
4. **The retired teal** — any of the ten hex values that made up the previous
   `signal` ramp, in case a stale value gets pasted back in.

Run it with `npm run guards`. Clean output is `design-guards: clean`; any
violation prints the file, line, and a one-line fix hint, and the script
exits 1.

## What is NOT done: Phases 2 and 3

Phase 1 built the token layer, the guards script, and recomposed a small,
explicit set of shared components and pages (see the per-task history in
`.superpowers/sdd/2026-08-11-dashboard-cobalt-facelift-phase1/progress.md`
for exactly which). **29 routes still inherit the new world only through the
token remap described above — they have not been individually composed or
visually reviewed.** They render in the new colours, type, radius, and
shadows because the tokens they already reference were redefined underneath
them, not because anyone opened those files this phase. Phase 2 and Phase 3
are where those routes get individually composed, and where `/_tokens`,
`/tokens-sheet`, and the `next.config.js` rewrite that makes `/_tokens`
resolve (marked `TODO(phase-3-cleanup)`) are scheduled for deletion.

## Known gaps

Carried from `progress.md`, not resolved in this task:

- **Duplicate `body {}` selector** in `globals.css`'s `@layer base`
  (`globals.css:159-160`) — a new `@apply bg-surface text-text` rule sits
  beside the pre-existing font-smoothing rule instead of being merged into
  it. Harmless (no cascade conflict), but untidy. Triage whenever that file
  is next touched.
- **~20 lines lost their leading indentation** inside multi-line template
  literals during the Task 2 mechanical sweep (queue, reports, onboarding
  ×2, connections, `calls/[id]`, business, assistant pages). Still present —
  spot-checked at `assistant/page.tsx:157` and `queue/page.tsx:215,227`.
  Inert — behaviour and rendering are unaffected — but it is exactly the
  "reformat unrelated code" outcome the original plan warned against.
- **3 ambiguous fills defaulted to `bg-surface-dark`** under the sweep's
  fallback rule (`assistant/page.tsx:157,182`; `calls/[id]/page.tsx:136` —
  chat bubbles/avatars). No visible change in light mode; low contrast in
  dark mode. These routes are Phase 2/3 territory anyway; revisit when they
  are composed.
- **8px lamp dots read as flat**, not structured (rim + specular highlight +
  core), at the smallest size (`StatusLamp.tsx:59`, `sm: 8`) — a pre-existing
  property of the design at that scale, not a Phase 1 regression, but worth
  revisiting if "lamps differ by structure, not hue alone" is meant to hold
  at every size.
- **6 display tables are still hand-rolled `<table>` markup** rather than
  the shared `Table`/`TableShell` primitives: `agents/page.tsx:102`,
  `audit/page.tsx:83`, `clients/[id]/agent/page.tsx:318`,
  `reports/page.tsx:241`, `support/page.tsx:214`, `business/DemandCluster.tsx:126`.
  They inherit the palette
  through tokens but not the primitives' keyboard row activation or
  empty/loading states. (`calls`, `clients`, and `crm` were converted to the
  shared `Table` primitive since this list was first written and are no
  longer in this gap — verified via their `from '@/components/Table'`
  imports.)
- **Authenticated routes were never visually verified during this phase.**
  Every component that lives behind the dashboard's login (the nav rail,
  `ThemeToggle` in its real location, both `Drawer` and `ConfirmDialog` in
  their real call sites, and all 29 inherited-only routes) has been read and
  reasoned about, but not screenshotted signed in, because doing so would
  require a real authenticated session and no shortcut around that
  (forged token, stubbed middleware, seeded credential) is permitted. The
  Task 12 evidence package documents exactly which routes were reachable
  without authentication and which were not, rather than working around the
  gap.

## Testing

There is no test framework in this workspace, by design (see the global
constraints for this build — no test framework may be added). `npm run
guards`, `npx tsc --noEmit`, `npx eslint .`, and `npm run build` are the full
verification gate; `npm run guards` is the only one of the four that checks
anything specific to this design system rather than general TypeScript/lint/
build correctness.
