---
name: Calendry
description: A dense, precise scheduling instrument for timetablers who live in it for hours.
colors:
  # Neutrals — surface (ground outward) and content (text/icons/hairlines).
  # Named by ROLE and distance from the ground, never by lightness: `surface1`
  # is the second surface layer in every theme, only its value changes.
  surface0: "#F7F7FA"
  surface1: "#F2F2F7"
  surface2: "#EDEDF2"
  surface3: "#E6E6EB"
  surface4: "#DEDEE7"
  surface5: "#D5D5E4"
  surface6: "#bfbfc2"
  surface7: "#aaaaac"
  content0: "#131316"
  content1: "#18181B"
  content2: "#202024"
  content3: "#26262C"
  content4: "#2B2B33"
  content5: "#30303C"
  content6: "#3c3c3f"
  content7: "#525255"
  # Primary — Signal Teal, the brand mark and the interface's one accent.
  primary700: "#1E6B61"
  primary600: "#257F72"
  primary500: "#2F9E8F"
  primary400: "#58B4A7"
  primary300: "#8ACDC3"
  primary200: "#D9EDE9"
  primary100: "#EFF7F5"
  # Secondary — Warm Clay, illustrations and empty states only.
  secondary700: "#94502F"
  secondary600: "#A85E38"
  secondary500: "#BE6E45"
  secondary400: "#D08C68"
  secondary300: "#E0AC90"
  # State colors — mean only themselves, never reused as decoration.
  success700: "#1F7442"
  success600: "#26894E"
  success500: "#2E9E58"
  success400: "#5CB77D"
  success300: "#8FCEA6"
  warning800: "#8A5A12"
  warning700: "#A87121"
  warning600: "#C08628"
  warning500: "#D69B33"
  warning400: "#E4B662"
  warning300: "#EFCF95"
  error700: "#9E2B36"
  error600: "#B93841"
  error500: "#D14A4F"
  error400: "#E0777A"
  error300: "#EDA4A5"
  info700: "#1F5C8F"
  info600: "#2872AB"
  info500: "#3389C6"
  info400: "#66A9D8"
  info300: "#97C7E7"
typography:
  display:
    fontFamily: "Noto Sans, Arial, sans-serif"
    fontSize: "32px"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "normal"
  headline:
    fontFamily: "Noto Sans, Arial, sans-serif"
    fontSize: "24px"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "normal"
  title:
    fontFamily: "Noto Sans, Arial, sans-serif"
    fontSize: "17px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "normal"
  body:
    fontFamily: "Noto Sans, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Noto Sans, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "0.05em"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "10px"
spacing:
  "1": "2px"
  "2": "4px"
  "3": "6px"
  "4": "8px"
  "5": "12px"
  "6": "16px"
  "7": "24px"
  "8": "32px"
  "9": "48px"
  "10": "64px"
  "11": "96px"
components:
  button-primary:
    backgroundColor: "{colors.primary500}"
    textColor: "{colors.content0}"
    rounded: "{rounded.sm}"
    padding: "8px 20px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.primary400}"
    textColor: "{colors.content0}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.content5}"
    rounded: "{rounded.sm}"
    padding: "8px 20px"
    height: "40px"
  button-transparent:
    backgroundColor: "transparent"
    textColor: "{colors.content5}"
    rounded: "{rounded.sm}"
    height: "40px"
  chip-session:
    backgroundColor: "{colors.surface3}"
    textColor: "{colors.content4}"
    rounded: "{rounded.md}"
    padding: "6px 8px"
  chip-session-hard-violation:
    backgroundColor: "{colors.error300}"
    textColor: "{colors.content4}"
    rounded: "{rounded.md}"
  input-search:
    backgroundColor: "{colors.surface0}"
    textColor: "{colors.content3}"
    rounded: "{rounded.lg}"
    padding: "6px 12px"
  badge:
    backgroundColor: "{colors.primary500}"
    textColor: "{colors.primary700}"
    rounded: "{rounded.sm}"
    padding: "2px 6px"
---

# Design System: Calendry

## Overview

**Creative North Star: "The Working Grid"**

Calendry's whole visual system defers to one surface: the minute-true schedule
grid, drawn in a single CSS Grid where a cell layer and a session layer share
one coordinate space. Everything else in the product — toolbar, inspector,
management tables, forms — is chrome built around that one precise object, in
the same restrained neutral material so the grid never has to compete with its
own frame for attention.

The mood is calm, precise, unhurried. This is an Operate surface a timetabler
spends hours inside, often beside a second display, making many small
corrections to an already-mostly-placed term. Nothing here is trying to be
noticed; everything is trying to be read correctly at a glance and trusted.
The one accent color — Signal Teal — is spent almost entirely on a single
meaning ("the system is offering you something: a cell to drop into, a focus
ring, an active filter"), which is what lets it stay legible as a signal
instead of decoration. Confirmed anti-references: this is not a playful
consumer calendar, not a generic bootstrapped SaaS admin template, and never
glassy or skeuomorphic — no drop shadows on resting surfaces, no gradients as
ornament, no rounded-pill maximalism.

**Key Characteristics:**
- One accent, one job: Signal Teal marks placement and selection, nothing else.
- Flat by default; depth is reserved for things that float above the page.
- Compressed, purposeful type scale (11–17px in-app) — density is a committed decision, not an oversight.
- Violations are never color-only: icon + tint + screen-reader text, every time.
- Material Symbols icons throughout, at small, consistent sizes (13–20px).

## Colors

Two neutral ramps carry the whole surface; one accent is reserved almost
entirely for a single meaning; state colors mean only themselves.

### Primary
- **Signal Teal** (`#2F9E8F` / `primary500`): the brand mark and the interface's
  one accent, spent on "the system is offering you something" — placement-mode
  target cells, the selected chip's outline, focus rings, the active violations
  toggle. It is a **fill**, not a text color: measured at 2.9:1 against the page
  ground, it fails as text but passes as a fill background. `primary700`
  (`#1E6B61`) is the ramp's text-and-pressed-state end, at 5.6:1 on `surface0`.
  `primary400` (`#58B4A7`) is the hover fill; `primary200`/`primary100` exist
  only as a selected-row tint and a hover ground — no other ramp goes this
  light, because no other ramp is ever used as a ground.

### Secondary
- **Warm Clay** (`#BE6E45` / `secondary500`): the one warm counterweight,
  reserved for illustrations and empty states — never a second accent for
  interactive state.

### Neutral
- **Surface ramp** (`surface0` `#F7F7FA` → `surface7` `#aaaaac`): the page
  ground outward. `surface0` recesses (empty grid cells, hatched
  not-teaching-time behind a session); `surface1` is the page ground and every
  raised chrome panel (toolbar, inspector, side panels); `surface3`→`surface4`
  on hover is the session chip, the one routinely-raised object; `surface5` is
  the hairline for grid gaps and control borders; `surface6`/`surface7` are
  metadata text and disabled states.
- **Content ramp** (`content0` `#131316` → `content7` `#525255`): text and
  icons. `content4` is the default body color; `content0`–`content2` are
  titles and the highest-emphasis labels; `content6`/`content7` are secondary
  and tertiary text, badges, and metadata.

### Named Rules
**The One Signal Rule.** Signal Teal appears only where the system is offering
the viewer something to act on — a droppable cell, a focus ring, a selection,
an active toggle. It never decorates a heading, a card, or a static badge; a
surface where teal shows up "just because" has broken the rule that makes it
readable as a signal at all.

**The Measured-Contrast Rule.** Every color pairing on this surface was
measured, not eyeballed — `primary500` reads ink (`content0`), not white,
because white-on-teal measures 3.14:1 and ink measures 5.7:1; `warning700` gets
its own darker `warning800` step for text because the ramp's darkest still
fails AA at 3.73:1. A new color pairing earns its place with a contrast
measurement, not a glance.

## Typography

**Body/UI Font:** Noto Sans (self-hosted via `@nuxt/fonts`), with Arial,
sans-serif fallback. Variable-font axes are pinned explicitly (`"wdth" 100`,
optical sizing on) so the face never drifts with a browser's own defaults.

**Character:** A workhorse UI face with no point of view of its own — correct
for an Operate surface, where a display face would compete with the data it is
meant to present cleanly.

### Hierarchy
- **Display** (400, 32px, 1.25 line-height): the largest step used inside the
  app; a further 44px step exists but is reserved for the public landing
  surface only and never appears in `/manage` or `/schedule`.
- **Headline** (400, 24px): page titles.
- **Title** (650, 17px): panel and section titles.
- **Body** (400, 14px, 1.5 line-height on wrapping text): forms, panel copy,
  review text. A 12px secondary-body step (`--font-size-sm`) carries table
  meta, chips, and captions — the scale's workhorse, more common than 14px
  itself.
- **Label** (650, 11px, 0.05em tracking, uppercase): field labels, section
  headings, badges. This is the *only* uppercase register in the system —
  nothing else is set in caps.

### Named Rules
**The Tabular Numerals Rule.** Every clock time, week number, and count is set
`font-variant-numeric: tabular-nums`. Without it the time column and any live
count shiver row to row as digits change width.

**The Tight-By-Default Rule.** Line height defaults to 1.25 (chrome:
single-line labels, chips, table cells, buttons, all living in px-exact rows).
Only text that actually wraps — paragraphs, hints, empty-state copy — opts up
to 1.5; the schedule grid must never take the wrapping step, or its rows lose
px-exactness.

## Layout

The schedule grid is one CSS Grid with two layers sharing a coordinate space —
a cell layer (background, hit targets) and a session layer positioned by
explicit `grid-column`/`grid-row: span n`, columns from the tenant's
`TimeGrid.activeDays`, rows from `blocksPerDay`. No fallback shape exists
anywhere: an unconfigured tenant gets an empty state, never a guessed
Mon–Fri week. Row density is user-adjustable through a single `--row-height`
custom property.

**Responsive strategy is a replacement, not a scale-down.** Below 1365px the
week grid is replaced outright by a day agenda with a day switcher — the same
data and the same chip component in a different structure, because a
seven-column grid is unreadable at any scale on a phone. Breakpoints:
`≤699px` mobile-only, `700–1365px` tablet, `≥1366px` desktop. A fourth,
content-driven threshold (819px) governs only the header bar's own collapse
into a drawer, measured from its own contents rather than a device class.

Outside the grid, layout is conventional flex/flow composition on the
`space-1`…`space-11` scale (2px through 96px), with `space-9`–`space-11`
(48/64/96px) reserved for the public landing surface's larger vertical rhythm
— in-app screens top out at `space-8` (32px).

## Elevation & Depth

**Flat by default, with tonal layering carrying depth on resting surfaces.**
Cards, panels, and table rows never carry a shadow; a raised surface is simply
one step lighter or darker on the `surface` ramp (`surface1` panel on
`surface0` recessed cell, `surface3`→`surface4` chip on hover). Shadows are
reserved entirely for content that floats *above* the page in its own
stacking context — modals, the command palette, drawers, popover-style solver
controls — never for anything sitting in normal document flow.

### Shadow Vocabulary
- **Overlay float** (`box-shadow: 0 24px 60px rgba(content0, 0.28)`): modals,
  dialogs, drawers, the command palette. Direction adapts to the overlay's
  entry edge (e.g. `-24px 0 60px` for a drawer sliding from the right).
- **Popover lift** (`box-shadow: 0 8px 24px rgb(0 0 0 / 32%)`): smaller
  floating controls (solver control panel, blocked-day picker) that sit above
  content but not full-screen.

### Named Rules
**The Floats-Or-Flat Rule.** If it's in document flow, it's flat and reads
depth through the surface ramp. If it floats above the page in its own
stacking context, it gets a shadow. Nothing in between.

## Shapes

Four radius steps, used by role rather than by component: `--radius-sm` (4px)
for buttons, small badges, and swatches; `--radius-md` (6px) for the session
chip; `--radius-lg` (8px) for search inputs; `--radius-xl` (10px) for panels,
scrollable table containers, and empty-state blocks. Borders are 1px and drawn
from the `surface` ramp (`surface4`/`surface5`) — an occupied grid cell is told
apart from an empty one by an edge, not a fill, since the fill cannot be
raised without flattening the ramp itself. Corners are never fully rounded
except the 7px kind-color dot on a session chip and true circular controls;
nothing in the system reaches for a pill shape.

## Components

Buttons, chips, and inputs read as **tactile and confident** — solid fills
that lift on hover, sharp state changes driven by measured contrast, no soft
or muted transitions standing in for feedback.

### Buttons
- **Shape:** 4px radius (`--radius-sm`), 40px min-height (32px at the `S`
  size), `8px 20px` padding.
- **Primary:** `primary500` fill, ink label (`content0`, not white — see the
  Measured-Contrast Rule), `primary400` on hover, `primary300` on
  active/focus. A disabled primary keeps the ink label over a near-invisible
  2%-alpha white wash rather than switching to a white label that would
  vanish.
- **Secondary / Destructive:** transparent by default, filling to
  `whiteAlpha4` on hover and `primary500` on active/focus (destructive's label
  is `error600`).
- **Transparent:** for controls sitting on other content (a chevron, an inline
  toggle) — never filled at rest, keeps the 40px hit target and radius so it
  stays a real target rather than a text run.
- **Link:** no padding or radius, underlined, 11px (`--font-size-xs`).
- **Hover/Focus:** 300ms transition on desktop pointer devices only
  (`@include pc`); a 2px `primary600` focus ring, inset on filled variants
  (`outline-offset: -2px`) so it isn't clipped by a flush toolbar edge.

### Chips (Session Chip — signature component)
The one repeated object across grid and agenda, and the closest thing this
system has to a mascot.
- **Shape:** 6px radius, 1px `surface5` border (the pair measured at 1.16:1
  against `surface0` — occupancy reads as an *edge*, since the fill can't be
  raised without flattening the surface ramp).
- **Fill:** `surface3` at rest, `surface4` on hover, with a 1px lift
  (`translateY(-1px)`) on a 140ms `cubic-bezier(0.16, 1, 0.3, 1)` ease.
- **Violation tint:** an opaque linear-gradient tint layered *over* the base
  fill (never a translucent replacement, so nothing behind the chip shows
  through) — hard violations tint toward `error700` at 22% (30% on hover),
  soft toward `warning700`-family at 18% (26% on hover). Severity always
  carries an icon too (`error` filled / `warning-outline`), never color alone.
- **Not-teaching time:** a diagonal hatch (`repeating-linear-gradient` at
  135°) over `surface0`, opaque rather than tinted, because a tint would read
  as a variation of the session rather than a break from it.
- **Online delivery:** a dashed border in the tenant's configured online
  color (or `content6` if unset) — never color alone, since it must survive
  greyscale.
- **Selected:** `surface5` fill with a `primary600` outline, inset 2px.
- **Kind:** a 7px filled dot beside the label, not an edge stripe — a stripe
  is the most recognizable "category" tell but adds noise at a 44px row
  height; a dot survives.

### Cards / Containers
- **Corner Style:** 10px radius (`--radius-xl`) for panels, scrollable table
  wrappers, and empty-state blocks; 6px (`--radius-sm`) for inline swatches
  and small chrome elements.
- **Background:** `surface1` (panels), `surface0` (recessed).
- **Shadow Strategy:** none — see Elevation & Depth. Depth is the ramp step,
  not a shadow.
- **Border:** 1px `surface4` where a container needs a defined edge (search
  field, table row swatches); omitted where the surface-ramp step alone
  already reads as a boundary.

### Inputs / Fields
- **Style:** 1px `surface4` border, 8px radius (`--radius-lg`), `surface0`
  background, `content3` text.
- **Focus:** border shifts to `primary500` (`:focus-within`) — no glow, no
  ring, since the field's own border is the whole indicator.

### Navigation
- Table rows: `surface2` on hover, inset 2px `primary600` focus ring, pointer
  cursor over the full row (rows are click targets to a detail view).
- Header/nav: collapses at a content-measured 819px threshold, not a device
  breakpoint — the logo drops to its mark and the nav moves into a drawer.

## Do's and Don'ts

### Do:
- **Do** spend Signal Teal only on "the system is offering you something" —
  a target, a focus ring, a selection, an active toggle.
- **Do** signal violation severity with icon + tint + screen-reader text
  together, never color alone.
- **Do** use tonal surface-ramp steps for depth on anything in normal document
  flow; reserve shadows for content that floats above the page.
- **Do** measure a new color pairing's contrast before using it as text —
  several ramp steps (`primary500`, `warning700`) fail as text and pass only
  as fills or borders.
- **Do** keep uppercase text exclusive to the 11px label register
  (0.05em tracking); nothing else in the system is set in caps.
- **Do** use tabular numerals on any value that changes in place (clock times,
  counts, week numbers).

### Don't:
- **Don't** add a card shadow, gradient, or glassy/blurred surface to
  anything sitting in normal document flow — that's the overlay vocabulary
  and belongs only to modals, drawers, and popovers.
- **Don't** introduce a second accent color for interactive state. Warm Clay
  is decorative-only (illustrations, empty states); every other state color
  means only itself.
- **Don't** scale the week grid down for mobile. Below 1365px it is replaced
  by the day-agenda structure, not shrunk.
- **Don't** reach for a pill/fully-rounded shape; the system's radius steps
  top out at 10px.
- **Don't** hardcode a font-size, radius, or spacing literal in new work —
  reach for the token scale (`--font-size-*`, `--radius-*`, `--space-*`); a
  retrofit of the remaining hardcoded literals in older components is tracked
  separately and does not license new ones.
