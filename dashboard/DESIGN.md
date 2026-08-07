# Design

Recorded from the built world, not from intention. Where this file and the code
disagree, the code is right and this file is stale.

## The world

**A supervisory panel read in daylight.**

The console's ancestor is the telephone exchange lamp field: a wall of jewel
lamps where a supervisor learned the state of every line before reading a single
label. That is what this product does across tenants, so that is the grammar it
is built in.

Two defaults were refused explicitly:

- **Dark console with a neon accent.** The category default for anything that
  wants to signal AI. Rejected because the use scene is an operator scanning
  dense comparison tables for long stretches in bright office light, then
  screenshotting rows into tickets. Light won on the scene, not on taste.
- **White enterprise dashboard with a blue accent.** The incumbent, and the
  predictable opposite of the first default.

"Frontier" is carried by instrument precision (calibrated state, tabular
figures, live measurement), never by mysticism (no neural mesh, no particle
field, no gradient glow).

## The governing rule

**Chroma is reserved for state.**

Green, amber, and red mean good, fair, and bad. Nothing else on the surface may
use them. Because of that, interactive affordance is *achromatic* — primary
buttons, active nav, and links are graphite ink, so a call-to-action can never be
misread as a healthy row, and a lit lamp always means state.

This is the constraint the whole palette is derived from, and it is the one to
protect when extending the system.

## Color

| Role | Token | Value |
|---|---|---|
| Ground | `panel-50` | `#F4F6F6` |
| Surface | white | `#FFFFFF` |
| Housing (rail, login panel) | `ink-900` | `#101314` |
| Primary action | `ink-800` | `#1A1E1F` |
| Body text | `ink-800` | `#1A1E1F` |
| Secondary text | `panel-600` | `#545D5D` |
| Hairline | `panel-200` | `#D8DDDD` |
| Focus / link / selection | `signal-600` | `#0B6E7F` |
| Lamp good | `lamp-good` | `#1FA35F` |
| Lamp fair | `lamp-fair` | `#E0921A` |
| Lamp bad | `lamp-bad` | `#DC3B30` |

Panel grey is deliberately green-shifted rather than the blue-slate every
dashboard ships. `signal` teal exists so focus and links have a hue that is
emphatically *not* a lamp.

Lamp text uses the `-ink` variants (`lamp-good-ink` etc.), which clear 4.5:1 on
white and on their own `-wash` backgrounds. The lit `core` values are for the
lens only and must never be used as text.

**Legacy names are remapped, not removed.** `primary` → ink, `navy` → panel,
`secondary` → signal, `gray` → panel, and `green`/`amber`/`red`/`emerald`/
`yellow` → the lamps. This is why routes that were never hand-revised still sit
in the new world. Do not "clean this up" by deleting the aliases without first
migrating every consumer.

**On dark surfaces, minimum text token is `panel-400`.** Anything darker looks
correct in isolation and fails contrast on `ink-900`.

## Type

- **Archivo** (`--font-sans`) for UI and display. Chosen for flat terminals,
  tight apertures, and real tabular figures. It replaced Plus Jakarta Sans,
  whose rounded humanist warmth fought the instrument reading.
- **JetBrains Mono** (`--font-mono`) for measurement only: counts, durations,
  ids, routes, stack traces. Never as a costume for "technical".
- `font-variant-numeric: tabular-nums` is applied globally to tables, `time`,
  `.tabular`, and `[data-numeric]`. Every figure here is compared against
  another figure, so digits hold their column.
- Headings set face and weight but **not colour** — they inherit it. A blanket
  heading colour silently rendered the login headline near-black on near-black.
  Do not reintroduce one.

## Material

- **Elevation is declared once.** Cards are hairline-bordered surfaces with **no
  shadow**. The 1px-border-under-a-soft-shadow "ghost card" is not used.
- Shadow is reserved for layers that genuinely float: drawer, toast, menu, the
  mobile nav panel.
- **Radius rule:** cards `12px` (`rounded-xl`), controls `6px` (`rounded-md`),
  status chips full pill. One rule, followed everywhere.
- The active nav row is a *depressed key* — seated inset background plus the
  `shadow-seat` inner highlight. Not a coloured stripe on the edge.

## The lamp

`src/components/StatusLamp.tsx` is the centre of the system.

The lens is drawn with a rim, a body, and a specular highlight at the top-left,
so the three states differ by **internal structure and brightness, not only
hue**. A lit lamp throws a small halo onto the panel around it; this is light,
not a glow effect, and it is sized to stay that way.

**Colour is never the carrier.** A lamp always ships with a word, and when no
visible word sits beside it, it carries an `sr-only` one. This survives
greyscale printing, a screenshot pasted into a ticket, and every form of colour
blindness.

`live` (the breathing pulse) is reserved for a state that is *actively wrong
right now* — currently `fatal` severity and the aggregate bad verdict. It is not
decoration and must not be applied to every lamp on a page.

Backend vocabularies map on through `SeverityLamp`, `SyncLamp`, and `ReviewLamp`
rather than at each call site.

## Motion

One authored moment, not scattered effects: `animate-rise` on page entry, and
the lamp breath. Exponential ease-out (`cubic-bezier(0.16, 1, 0.3, 1)`) from an
already-visible default. A global `prefers-reduced-motion` block collapses
everything.

## Browser surfaces

Selection, caret, `accent-color`, scrollbars, focus rings, placeholder colour,
and underline offset are all themed from the palette in `globals.css`. Left at
their defaults these belong to no design system.

## Data visualisation

`.viz-root` series are teal (`#1E7A90`) and mulberry (`#9B4D93`). The previous
blue/orange pair put a series colour inside the amber lamp's hue range, which
let a chart line read as a status.

**These two slots have not been re-run through the numeric CVD/contrast gate
that validated the previous pair.** They are reasoned, not measured. Re-validate
before adding a third categorical slot.

## Freshness and destructive actions

Two conventions the console now depends on:

**A reading always shows its age.** The lamp field polls every 30s, stops while
the tab is hidden, and refreshes on return. The header states how long ago it
read, and switches to an amber `stale ·` label past 90s. A refresh that fails
keeps the last good values rather than blanking the panel — the staleness clock
is what tells the operator the reading is aging, so it must never be replaced by
an empty state.

**Irreversible actions confirm, and the dialog names the consequence.**
`ConfirmDialog` states what will happen ("marks all 96 occurrences as reviewed,
under your name, and cannot be undone"), never "Are you sure?". Cancel takes
initial focus; the destructive button never does, so a repeated or reflexive
Enter resolves to "nothing happened". Focus is trapped and returned to the
invoking control.

## Language

`lib/vocabulary.ts` is the terminology glossary and the only place a backend
enum becomes a word. `warn` reads as "Warning", `startup` as "Startup",
`resolved` (job) as "Re-queued". An unrecognised code is humanised, never
rendered raw. Filter options are generated from the same tables as the rows they
filter, which is what stopped `startup` being "Process" in one place and
"Startup" in another.

Terms the product cannot avoid (fingerprint, severity, reviewed) carry a
`Hint` — a real button, not a hover tooltip, because hover has no keyboard or
touch equivalent and the users most likely to need a definition are the least
able to reach one. The definition sits in the accessibility tree whether or not
the panel is painted.

**Hints are rationed.** Three per table at most, on genuinely product-internal
terms. A hint on every column is noise, and noise is what made help invisible
before.

## Tables

One implementation. `components/Table.tsx` holds the primitives (`TableShell`,
`Table`, `THead`, `TH`, `TBody`, `TR`, `TD`, `TableEmpty`); `DataTable` is a
column-driven wrapper over them, and screens needing bespoke cells compose the
primitives directly. Previously `DataTable` carried the chrome, sticky heads,
keyboard row activation and a real empty state, while hand-rolled `<table>`
markup in system/users/settings carried none of it.

`TR` takes `onActivate` rather than `onClick`, which is what makes a clickable
row focusable and Enter/Space-operable. Use it; do not put `onClick` on a raw
`<tr>`.

## Known gaps

- **Light-locked.** `color-scheme: light`, no dark variant. Decided from the use
  scene. Adding dark mode means re-deriving the lamp `-ink` values, which are
  tuned for light grounds.
- **Verified surfaces.** Login, the shell, the overview, and System Health were
  built and inspected directly. The other ~15 routes inherit the world through
  the token remap and the shared components; they have not been individually
  composed.
- **Eight display tables are still hand-rolled** and inherit the palette but not
  the primitives, so their rows are not keyboard-operable and their empty and
  loading states are inconsistent: `agents`, `audit`, `calls`, `clients`,
  `clients/[id]/agent`, `crm`, `reports`, `support`. Migrated so far:
  `DataTable`, `system`, `users`, `settings`.
  (`ChartCard` and `InlineEditTable` also contain `<table>` markup but are
  deliberately different: one is a screen-reader alternative to a chart, the
  other an editable grid. Neither should adopt the display-table chrome.)
- No keyboard shortcuts and no saved filter views. Filters already live in the
  URL, so saved views are mostly a naming problem, not a data one.
- **Reduced motion caps transitions at 90ms rather than deleting them.** The
  usual blanket `0.01ms` kill also destroys the hover, focus, and lamp-state
  feedback this interface runs on. Do not "simplify" it back.
- Charts (`ChartCard`, `OutcomeChart`, `VolumeChart`), `Drawer`, `Tabs`,
  `InlineEditTable`, and `SlaCountdown` inherit tokens but were not
  recomposed.
