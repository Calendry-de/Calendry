# CLAUDE.md — Calendry

Read this file at the start of every session. TAXONOMY.md is the taxonomy
source of truth; this file is everything else needed to work in this repo
consistently across sessions.

## What this project is

Multi-tenant calendar/timetabling platform for schools and universities, two
parts built in sequence:

1. **Calendar management app** (this repo, Nuxt) — entities, database, CRUD
   and editing routes, multi-tenant auth, import/export.
2. **Solver** (`calendry-solver`, Rust) — Offerings + Constraints →
   near-optimal Session placement via hybrid constructive + local-search
   optimization, called via a service contract (gRPC). Its own repo is the
   source of truth; a checkout is vendored into THIS repo as a git
   submodule at `vendor/calendry-solver` (with `calendry-proto` nested one
   level deeper, at `vendor/calendry-solver/vendor/calendry-proto`) purely
   so `docker compose up` can build the whole stack from one checkout.
   **Do not author solver logic here** — changes to solver behavior belong
   in `calendry-solver`, then get vendored back via the submodule pointer.

Rule of thumb: does it generate/optimize a schedule (solver's job) or
manage/store/present one (this repo's job)?

## Source of truth documents

- `TAXONOMY.md` — the fixed entity model. Authoritative; don't
  add/rename/restructure core entities without explicit confirmation —
  "carved in stone," changes here are migrations, not config edits.
- `CLAUDE.md` (this file) — **durable**: architecture rules, RLS
  boundaries, standing conventions, live facts a session would break
  something by not knowing. Anthropic's own guidance targets ~200–300
  lines; keep trimming toward that — state a fact/rule/number once, link
  reasoning to `DECISIONS.md`, never re-narrate an investigation inline.
- `DECISIONS.md` — **archive**: the story behind resolved incidents (how a
  bug was found, what was measured). Split out 2026-08-26.
- `BACKLOG.md` — **transient**: open bugs, deferred work, undecided
  questions, the phase checklist. Split out 2026-08-23.

Dividing question: what not to undo (→ CLAUDE.md), the no-longer-live story
behind a decision (→ DECISIONS.md), or what someone might still do (→
BACKLOG.md)?

## Fixed vs. open taxonomy

**Fixed** (schema-level, changing = migration): Federation, Tenant, Person,
Group (nestable), Room, Offering, Session, TimeGrid, Term, Constraint,
Membership, Assignment.

**Open** (tenant-managed vocabulary, changing = data): Role names,
Equipment/Feature tags, Offering/Session `kind` values, Constraint parameter
values. Never hardcode an open value into logic (never assume a Role called
"Student," never assume a `kind` called "lecture") — always resolve against
tenant config.

## Architecture rules

- **Multi-tenant, isolated by default.** Every tenant-scoped table carries
  `tenant_id`; RLS enforces it at the DB layer, not just in app code.
- **Runtime connects as the non-owner role.** `DATABASE_URL` uses
  `calendry_app` (owns nothing, `FORCE ROW LEVEL SECURITY`).
  `MIGRATION_DATABASE_URL` (the owner) is for Prisma CLI/provisioning only.
  Pointing the app at the owner silently disables every RLS policy and every
  test would still pass. Never do it.
- **Migrations are schema-only; seed populates data.** A freshly migrated
  database is deliberately unusable — `permission` is empty, provisioning
  fails loudly on the `access_role_permission` FK.
- **Never regenerate `prisma/migrations/`.** Hand-written RLS/triggers can't
  be expressed in `schema.prisma`; `prisma migrate dev` diffs against it and
  emits a migration that silently DROPS them (every table exists, isolation
  silently gone, tests still pass). Rebuild with `prisma migrate reset`
  (`db-reset` = `migrate reset --force && generate`, `migrate dev` removed
  2026-08-23 after it dropped three indexes this way — DECISIONS.md §
  "Database & migrations"). Any hand-written index/policy/trigger/function
  is invisible to `schema.prisma` and a standing deletion candidate.
  `db-drop` (`db push --force-reset`) is the same hazard, kept as an
  explicit escape hatch — never use it to rebuild a working database.
- **Never query outside `withTenant()`.** Route handlers go through
  `withRequestTenant`. A query outside it sees zero rows, not all rows —
  deliberate. Sole exception: `server/utils/authDb.ts`.

### The three deliberate exceptions to tenant isolation

Conscious boundaries, not oversights — a fourth is a bug.

1. **Federation-owned resources.** `room`/`equipment`/`offering`/`session`
   may be Federation- instead of Tenant-owned (shared lecture hall,
   cross-enrolled elective). CHECK enforces exactly one owner; RLS read
   widens to the federation, write stays tenant-only. See "Group↔Term
   scoping" for why this extends to `session` but not `group`/`person`.
2. **The pre-tenant auth plane.** `account`/`account_person`/`auth_session`
   carry **no RLS** — a session must be read before the tenant is known.
   Replaced by access shape: read only by PK or unique token hash from a
   verified cookie, never by tenant filter; `authDb.ts` is the only module
   permitted to query without tenant context. Tenant-scoped auth lookups go
   through `SECURITY DEFINER` functions `calendry_internal.session_identity()`
   / `account_identities()`, parameterised solely by a secret, never a
   tenant id.
3. **The background solver poller.** `calendry_internal.tenants_with_due_solver_runs()`
   runs when nobody is logged in, so `current_tenant_id()` is NULL —
   structurally outside the tenant-request model. Returns **tenant ids
   only**, no parameters; every actual write happens inside an ordinary
   `withTenant()` transaction.

Do not add a fourth exception without a comparably strong reason.

- **Nested Groups propagate conflicts** both directions (ancestor ↔
  descendant). TAXONOMY.md §6 before touching conflict-check code — don't
  walk the tree live in hot paths, use a precomputed closure.
- **`group_term` is a visibility scope, never a scheduling input.** Unlinked
  Group = visible in every Term (fail-open). Solver's Group filter never
  reads this table — see "Group↔Term scoping."
- **TimeGrid is per-tenant, not global.** Never hardcode block/timeslot
  arithmetic — always resolve against the tenant's TimeGrid/Term config.
- **History is event-sourced.** Manual edits are append-only events
  (`create`/`move`/`swap`/`delete`/`lock`) on a versioned Generation
  snapshot. Never mutate a Session without emitting the event. The
  append-only trigger on `session_event` permits exactly one exception (a
  Stage 5 addition): an UPDATE nulling `session_id`/`counterpart_session_id`
  and nothing else, so a Session can be deleted without destroying its
  audit trail.
- **Locked Sessions are solver-exempt** — a re-run skips them entirely.
- **Hard-constraint violations from manual edits: warn, don't block** —
  surfaced as queryable state, not a one-time toast.
- **Timezone is per-Person, display-only** — never affects grid resolution,
  constraint evaluation, or "same day" logic (all tenant-local time).

## Conventions

### TypeScript / type safety

- **No `any`, no unnarrowed `unknown`.** Every signature/boundary/return
  type concrete enough that `nuxt build`'s typecheck means something. A
  genuinely-unknown boundary value (webhook body, JSON column, external
  API) gets typed `unknown` and narrowed immediately (Zod schema, type
  guard) before use. `strict: true` is a floor — a wrong rule at one call
  site gets a scoped `eslint-disable-next-line` with a reason, never a
  blanket loosen.
- `tsconfig.json` extends `./.nuxt/tsconfig.json` plus `noUnusedLocals`,
  `noUnusedParameters`, `noFallthroughCasesInSwitch`. Prefer `satisfies`
  over an annotation when a literal needs both inference and a shape
  check; prefer a discriminated union over optional-field soup for real
  variants, so `switch`/`if` chains exhaustiveness-check.

### Design work

- Use the **`design-taste-frontend`** skill (`.claude/skills/`, source
  `Leonxlnx/taste-skill`) for visual/UI work; pair with **`frontend-design`**
  (`anthropics/skills`, fetch via `skills use ... --skill frontend-design`)
  for greenfield/reshaped UI — distinctive choices over the three
  AI-generated-design defaults (warm-cream serif / near-black-accent /
  broadsheet-hairline).
- Tokens (`app/scss/tokens-root.scss` / `tokens.scss`) remain the
  implementation layer regardless — see design-tokens rule below.

- **Naming**: `Offering` = recurring definition; `Session` = one placed
  occurrence. No "Lecture"/"Event"/"Class" as entity names — those are
  tenant-facing `kind` values.
- **Routes**: standard REST per entity; editing ops (`move`/`swap`/`lock`/
  `apply-generation`) are explicit verbs on Session, not generic PATCHes,
  so the event log records intent.
- **`/` is the PUBLIC landing page; `/dashboard` is the signed-in home.**
  `auth.global.ts` has two exemption lists that aren't interchangeable:
  `PUBLIC_ROUTES` (auth pages — need no session AND bounce a signed-in
  visitor) vs. `ANONYMOUS_ROUTES` (`/` — needs no session, bounces nobody).
  `HOME_ROUTE` in `app/utils/routes.ts` is the **only** place "where a
  signed-in session belongs" is written — it was `'/'` in four separate
  literals before, which is how a post-login redirect once landed on the
  marketing page. `/` reads no session, calls no API, exposes no tenant
  data (not the same as BACKLOG.md's unauthenticated-access items).
  Verification detail: DECISIONS.md § "Landing page / routing".
- **The landing page's claims are checked against BACKLOG.md by a test** —
  `tests/landing-page.test.ts` parses § "Current phase" and asserts
  unchecked entries match what the page presents as not built. Contact CTA
  is `mailto:`, not a POST (persisting it would be a 4th RLS exception for
  a public write).
- **Guards/detection conditions must fail loudly or match exactly.** A
  condition that can both "correctly find nothing" and "incorrectly match
  nothing from a bug" must be distinguishable — anchored matching, asserted
  shape, or reported action. Bitten repeatedly in different disguises —
  case log: DECISIONS.md § "Guards must fail loudly." Counter-example to
  copy: an unseeded-database provision fails on a FK and writes nothing.
- **A tracked-gap entry from design INTENT can drift from the code
  silently.** Prose is checked by nobody. Before acting on a tracked entry
  (here or in BACKLOG.md), confirm its claim against the code, measure if
  it's about performance. Applies with more force to BACKLOG.md — nothing
  references it, so nothing contradicts it when stale. Established by:
  DECISIONS.md § "Database & migrations" (three "missing" indexes).
- **Split a component past ~3 responsibilities or ~250 lines** (line count
  is the trigger to *look*, not the rule — cohesive SCSS bulk is fine).
  Pages compose, don't implement; a composable gets one ownership boundary.
  A composable calling `useAsyncData`/`useRequestFetch` must stay
  synchronous — an `await` inside detaches it from the Nuxt instance
  ("called outside a Vue setup function"); return the async-data handle,
  hold the top-level `await` in the page.
- **New style work uses design tokens, never literals** — colours from
  `--<colorName>` (per-theme via `useLayout()`), sizing from
  `--font-size-*`/`--radius-*`/`--space-*` (`app/scss/tokens-root.scss`).
  Applies to new work from Step 10 on; add a token deliberately if one is
  genuinely missing.
- **SSR fetches must use `useRequestFetch()`, never bare `$fetch`** —
  `$fetch` drops the browser cookie server-side, so an authenticated call
  401s and the page silently renders its empty state, indistinguishable
  from a legitimately unconfigured tenant. If "no data" and "fetch failed"
  render identically, the bug is invisible.
- **`--fix` tooling can rewrite files outside your change's scope** —
  `stylelint`/`eslint --fix` match the whole project, not your working set
  (once silently rewrote a debugged CSS value elsewhere — DECISIONS.md §
  "`--fix` tooling"). Scope the fixer to your paths; `git checkout --`
  anything outside scope afterward.
- **`export { x } from './y'` doesn't bind `x` locally** — throws
  `ReferenceError` if the same file also calls `x`, and `nuxt build`
  typechecks it clean. Import what you re-export if you still use it.
- **Vue doesn't flush watchers during SSR** — `watch(data, seed, {
  immediate: true })` runs once, before the fetch resolves, and never
  again. First-render state must come from the awaited promise
  (`const ready = (async () => { await asyncData; seed(); })()`), watcher
  only for later client refreshes. Bitten three times in different shapes
  — case log: DECISIONS.md § "SSR/watcher bugs." Generalisation: anything a
  watcher seeds is `undefined` at first render server-side; prefer
  `computed` over a watcher-assigned `ref` when first render depends on it.
  Verify rendered *content*, not element presence.
- **`<select>` needs `:selected` on `<option>`, not just `:value` on the
  select** — `value` is a property, dropped by SSR; browser falls back to
  the first option.
- **Permissions**: per-tenant, tenant-configured roles — never a hardcoded
  global role enum.
- **`Role` (TAXONOMY.md §2, scheduling vocabulary — Lecturer/Student) and
  `AccessRole` (§4, authorization) share a word but are different things.**
  Never merge them; never grant permissions via `Role`.
- **Permissions are fixed, roles are not** — catalogue is code
  (`server/utils/permissions.ts`, mirrored by migration); tenants bundle
  into AccessRoles but can't invent permissions. Adding one = editing both
  the constant and the migration.
- **A page must not depend on permissions its own gate doesn't imply** —
  enumerate every endpoint a page calls; one missing permission inside a
  `Promise.all` blanks the whole page with no error, the least diagnosable
  failure a UI has.

## Current phase

Tracked in **[BACKLOG.md](BACKLOG.md) § Current phase**, with the staged
solver plan — a checklist, not a decision to preserve.

## Solver integration (calendry-solver)

Three repos: `calendry` (this app, owns Postgres) ↔ `calendry-solver` (Rust
gRPC optimizer, **stateless**, vendored at `vendor/calendry-solver` — see
"What this project is" above) ↔ `calendry-proto` (shared schema; consumed
*here* as the npm package `@mindcollaps/calendry-proto`, **GitHub Packages
not npmjs.org**; consumed by the Rust side as its own nested submodule
inside `vendor/calendry-solver`, not checked out separately in this repo).
Solver is
functionally complete: 14 constraint types, LNS + simulated annealing,
`StartRun`/`GetStatus`/`CancelRun`. 27,000-Session instance solves in ~349ms.

**The solver never touches Postgres** — this app assembles a complete
`SolverInput` and sends it; every gap in the snapshot is a wrong answer the
solver has no way to detect.

**Per-person preferences: the app SENDS them, the solver does not read them yet.**
`assembleSolverInput` populates `Person.preferred` from `person_preference`
(proto `0.7.0`), narrowed to the solved Term's grid — the write boundary
validates against the tenant's WIDEST grid, so a stored block can name a slot one
Term has not got. A NULL `weight_multiplier` is sent as ABSENT, never 0: the wire
field is `optional` because proto3's zero is itself a meaningful multiplier.
**`person_preference_fit` deliberately has no `wireField`**, so the constraint
does not cross at all — the solver answers that variant with `UNIMPLEMENTED`, so
setting it before the evaluator lands would fail every solve for a tenant that
enabled the rule instead of merely doing nothing. The assembly report counts the
inert case (`placementsWithNoSignal == placementsCounted`) for the same reason
`lecturer_veto` went unnoticed: nothing counted it. Design record and staging:
`per-person-preferences-design.md`.

**`MinimizeRoomRank` has a direction parameter, `invert`** (`calendry-proto@0.5.0`):
`false` (default) penalizes `rank >= threshold` (spare best rooms); `true`
penalizes `rank <= threshold` (prefer them). New tenants seed `invert: true`
(direction, not enablement — `enabledByDefault` stays `false`). Full
reasoning: DECISIONS.md § "`MinimizeRoomRank` gains `invert`".

**Installing the proto package**: credential in `~/.bunfig.toml`/gitignored
`./bunfig.toml`, never committed (`bun run check:registry-auth` diagnoses
offline). Three things producing the same opaque 401: a bunfig scope token
needs that entry's own `url`; an `.npmrc` auth line overrides a bunfig
token; GitHub Packages needs a **classic** PAT (`ghp_`), rejects
fine-grained. Scope entries resolve nearest-first, wholesale not merged.

**Warn-and-allow parity**: a `SUCCEEDED` run with residual hard violations
is still an applicable Generation (same `constraint_violation` mechanism as
manual edits) — not discarded, not auto-applied. `GenerationStatus.INFEASIBLE`
is consequently unused for solver output by design. DECISIONS.md § "Solver:
warn-and-allow".

**Determinism: only the move budget is reproducible.** `(input, seed, move
budget)` → byte-identical output, but only when termination was
`move_budget` or `converged` — `time_budget` is not reproducible.
`termination_reason` says which. `maxMoves` default **30,000,000** (was
50,000, stopped ~21% short of convergence); wall-clock cap **30s** (was
10s, keeps move-budget the binding one). `StartRunResponse.seed` echoes the
seed used. Measurement: DECISIONS.md § "Solver: determinism & `maxMoves`".

**Idempotency key is `<inputHash>:<seed>`** — SHA-256 of the *encoded*
`SolverInput` (not JSON), so a repeat start against unchanged data returns
the same run. Budget is NOT part of the key — restart the solver between
measurements at different budgets, or you'll replay the first run.

**Staged plan**: all seven stages complete, changelog in
**[BACKLOG.md](BACKLOG.md) § Staged plan**. What's still live:

- **Stage 2**: concurrency enforced by a partial unique index (not
  `findFirst`); a failed StartRun resolves its own row to `FAILED`; a poll
  failure is NOT a run failure (`stale: true`, status untouched). Full
  verification: DECISIONS.md § "Solver: Stage 2 established".
- **Stage 4 polling**: background poller owns correctness, on-demand owns
  latency (both call `pollSolverRun()`). Results captured the moment a run
  goes terminal — the solver's registry is in-memory, no persistence.
  `NOT_FOUND` (gRPC 5) = solver lost the run, terminal, row → `FAILED`.
  Anything else including `UNAVAILABLE` = transient, row untouched. Claim
  is a **lease** (`FOR UPDATE SKIP LOCKED` + a per-tenant advisory xact
  lock), not a session lock — reasoning: DECISIONS.md § "Solver: Stage 4
  polling". During a solver outage, effective retry interval is the 30s
  claim lease, not adaptive cadence.
- **Virtual room capacity-1, RESOLVED cross-repo** (`calendry-solver`
  `99b41e3`). `capacity` still gates eligibility (no `concurrentCapacity`
  yet). The fix had been accidentally enforcing `MaxOnlineShare` — expect
  more `MaxOnlineShare` violations post-fix on heavy-online tenants (warn-
  and-allow working as designed). DECISIONS.md + BACKLOG.md § "Needs a
  decision, not a design pass".
- **`violations.ts`: membership flows DOWN, conflict flows BOTH WAYS.**
  `attendeeSets` uses `descendantGroupIds`, `conflictSets` uses
  `conflictGroupIds` — swapping either reintroduces an under- or
  over-reporting bug. DECISIONS.md § "`violations.ts`".

**Tracked wire-format gaps** (all in **[BACKLOG.md](BACKLOG.md) § Solver**,
each reports rather than narrows silently — don't "fix" by picking a
value): equipment quantity, multi-room Sessions, the solver's unbounded run
registry, violations naming solver-invented Sessions with no join key.

**Operator CLIs** — `create:account`/`create:role` for an existing tenant:

    bun run create:account -- --tenant test --email x@y.edu --name "…" [--role tenant-admin]
    bun run create:role -- --tenant test --key viewer --name "…" --permissions a.read,b.read [--dry-run]

Owner connection, audited to stdout. Existing email REUSED not duplicated;
duplicates fail loudly, never upserted; **no `--all`** for `create:role`
(compose from audited grants, don't mint an unaudited superuser role). Why
these exist: DECISIONS.md § "Accounts & roles".

Test accounts: `verify@calendry.local` (HTTP verification,
`VERIFY_ACCOUNT_PASSWORD` in `.env`); `vic@demo.local` /
`viewer6b@calendry.local` / `cviewer@calendry.local` hold `viewer` (six
reads, no `solver.trigger`/`generation.apply`) — use for asserting an
affordance is ABSENT, and also assert the page rendered. A rebuilt dev DB
has one role/account — recreate with one `create:role` + `create:account`
per test account.

**Constraint shape validated at the write boundary** — severity (must
match catalogue HARD/SOFT) and weight (`>= 0`, no ceiling) enforced via
`validateConstraintShape()` on CREATE and UPDATE (`beforeUpdate` validates
only touched fields, deliberately — merged-row validation would make a bad
row permanently uneditable). DB CHECK backs the weight floor. Why it
mattered: negative weight erodes `hard_penalty`'s margin for every rule in
the tenant. `params` still accepts arbitrary JSON — BACKLOG.md § Undecided.

**Step 14 — AccessRole management has no UI/API.** `access_role`/
`access_role_permission`/`person_access_role` deliberately absent from
`RESOURCES`/`RELATIONS` — needs a picker over the fixed catalogue, not a
generic form. Scope: BACKLOG.md § "Features not built".

**Auth**: `must_change_password` built (operator `reset:password` — revokes
sessions, sets flag, audits; login blocks until `POST
/api/auth/change-password`), gaps in BACKLOG.md § "Password policy gaps".
Federation-level permissions out of scope (TAXONOMY.md §9.4). Session
cleanup done — `sessionSweeper.ts` deletes `auth_session` past 30 days,
needs no RLS exception (none exists) and no claim machinery (idempotent
DELETE).

## The management area (Step 13)

`/manage` is one scaffold: three route files render every entity from
`app/utils/manageRegistry.ts`, which is also the nav source — sidebar,
index, header, palette can't drift from each other or the entity list.

- **Permission rule, uniform**: no `.read` → hidden entirely; `.read`
  without write → visible read-only, rendered as **static text, not
  disabled inputs**; unknown section → 404 (typo distinguishable from
  permission problem).
- **Bespoke means one slot** (`detailComponent`/`listComponent`), never a
  page — shell/header/permissions/save stay shared. Qualifying: GroupTree,
  TimeGridEditor, ConstraintBuilder, CalendarPeriodEditor. Offering is
  deliberately NOT bespoke — its complexity is registry data, not
  different code.
- **`custom: true`** keeps a field in draft/dirty-tracking/payload with a
  bespoke control; omitting it drops the field from saves silently.
- **Relations are PUT-set sub-resources**, saved immediately per change,
  not part of the entity's Save transaction. `warnAfterWrite` relations
  return `{ rows, warnings }`; every other relation returns a bare array.
- **The Ctrl+K palette holds no permission logic** — input is the
  already-filtered nav source.
- **Overlays claim the keyboard** via `useOverlay()`, following open
  *state* not the function that opened it.
- **Structural constraint types** (`RoomDoubleBooking` etc.) are
  tenant-toggleable at all three layers (app evaluator, solver input,
  solver's `convert.rs`) — not "always-on" despite some prose elsewhere
  claiming so.

Verification detail (the `paramField()` divergence, invisible-deprecated-
types bug, ten-file `vartorgba` styling bug, read-only-path test):
DECISIONS.md § "Management area (Step 13)".

## Schedule display standards

`tenant_display_settings` is a **singleton keyed by `tenant_id`** — no surrogate
`id`, so a second row per tenant is unrepresentable rather than constrained. An
**absent row means defaults** (`DISPLAY_DEFAULTS` in `shared/sessionColor.ts`);
provisioning deliberately does not seed one, so "never configured" and
"configured, unchanged" render identically. Read gated on `session.read`, write
on `session_kind.update` — an existing permission, chosen over minting one
because a new permission needs the catalogue, its migration mirror AND a
`grant:permissions` backfill before existing tenant-admins stop 403ing.

**Colour is RESOLVED, never read off one field.** `resolveSessionColor()` walks
the tenant's `colorSourceOrder` (default `offering` → `kind`) and returns
**null** when nothing supplies one — never a fallback accent. The chip previously
read `kind?.color ?? primary500`, so every session without a kind colour claimed
the colour reserved for "where a session may land". `null` at any level means
INHERIT, which is why every colour column is nullable.

**Online delivery stays a virtual Room** (TAXONOMY.md). `isOnlineSession()` asks
the rooms; the setting decides only whether that is drawn. Marked with a dashed
edge, so it survives greyscale and an unset colour — same rule as violations.

## Grid geometry is minute-true and rows grow

Both week grids (`ScheduleGrid`, `ScheduleReviewGrid`) share `useGridGeometry` +
`clusterSlots`. Three properties, each of which replaced a bug:

- **Rows are `minmax(<true minutes × perMinute>px, auto)`.** The minimum keeps
  the picture proportional; `auto` is what lets a crowded block grow instead of
  overflowing. **A slot must stay IN FLOW** — it was briefly `position:
  absolute`, and an out-of-flow slot contributes nothing to its row's height, so
  a block that could not fit its sessions silently overflowed.
- **A block's time label shares its grid ROW with that block's cells.** Alignment
  is structural, not computed, so the gutter cannot drift from the columns. Two
  separate bugs came from it not being so.
- **Placement inside a row is px at a CONSTANT scale**, never a percentage of the
  row. A percentage stretched with the row, so a minute was worth more pixels in
  a busy row than a quiet one, and a lone session rendered as tall as the crowded
  day beside it. Slots also need `align-self: start` or the grid stretches them
  — **except a slot spanning several rows whole, which needs `stretch`**. Its
  grid area also contains the row gaps between those rows and any height a row
  gained from another column's crowding; neither is a minute, so `min-height`
  always falls short and a two-block session drew as ending early. `bandWithin`
  sets this per slot; only the browser can measure it.

Past three abreast a cluster stacks as one-line chips rather than fanning into
slivers, and **nothing is ever hidden** — a collapse-past-three rule turned 17 of
20 slots in a real week into "+N more" buttons. **A crowded cluster emits one
slot per START BLOCK, each confined to that block's row**, and every member of
such a cluster goes compact even where its own block is quiet (a fanned member
spanning rows would be drawn over a compact stack). One slot for the whole
cluster put members at their list index rather than their time, and inflated
every row it spanned — a grid item whose content exceeds its spanned `auto`
tracks makes the browser distribute the excess across all of them, so a
30-minute break drew as tall as a 45-minute block and chips landed on the break
band. Safe only because compact mode already gives up drawing duration, so there
is no overlap left to avoid. Shared rows cost per-day drift:
a day whose own breaks move its blocks is NAMED (`dayDiffers` → "own breaks")
rather than drawn, and every chip and cell label resolves its own day's clock
time via `blockTime(grid, index, dayOfWeek)`. **Below a 30-minute block the
gutter labels on the hour** — a 15-minute grid is 44 rows and 44 stacked times is
not a time column; unlabelled rows keep their cell and their accessible name.

## The schedule toolbar's height is invariant, and that is load-bearing

`.bar` is a **grid with two named rows** (`'scope scope'` / `'view actions'`),
not a wrapping flex row — one row per group, so each row is sized by one group
and nothing else. Verified 146px at 1440/1280/1024 and 303px at 390 across
idle, live-solver and long-tenant-name states. One row does not fit: scope
621 + view 231 + actions 507 + gaps is 1407px of a 1408px row, so every
variable in it decided the bar's height.

Two things depend on that invariance and will break it if undone:

- **The solver's tall states are anchored panels** (`position: absolute` on
  `.solver_advanced`/`.solver_panel`/`.solver_error`, anchored to `.bar`, which
  carries `position: relative` + `z-index: 2` so they clear the sticky side
  column). In flow the bar went 142px → **321px** and the actions group's
  bottom alignment moved "Add event"/"Proposals" **190px down the page** for
  the duration of a run. Only the one-line status stays in the bar.
- **`align-items: end`** is what puts buttons on the selects' optical line
  rather than the labels' (measured 16px off before). It was `flex-start`
  precisely because a tall in-flow solver dragged every select down to meet it;
  it is safe only while nothing in that row can grow past a control's height.

**`.bar_select` is capped** (`max-width: 220px` + `text-overflow: ellipsis`,
and `max-width: 100%` under `mobileOnly` where 220px is half the row). A
`<select>` sizes itself to its widest option and every option here is tenant
free text — uncapped, realistic German names took Term 132px → 367px and the
bar to three rows. The four tenant-data selects carry a `:title` so a truncated
value stays recoverable by mouse.

## Academic calendar periods

`calendar_period` is a managed resource on the generic scaffold, gated on
`term.update` (child-of-Term, not a new permission), with one bespoke
field: a live week-reclassification preview. A period fully outside the
Term's range is rejected (400); overlapping periods within a Term are
allowed and unchecked (the EXAM-wins precedence rule needs overlap to have
meaning). Classification lives once, in `shared/academicCalendar.ts`'s
`classifyWeeks`, called by both the preview and the solver's input — `EXAM`
uses "touches the week," `BREAK`/`HOLIDAY` use "covers the entire week," so
identical dates can classify differently by `kind`. Closed a dead end: no
tenant could ever write a `calendar_period` row before this, so
`minimize_exam_week_sessions` reported zero violations while looking
healthy. DECISIONS.md § "Academic calendar periods".

## Group↔Term scoping, and why the solver filter is reference-derived

`group_term` is **many-to-many**, not `group.term_id` ownership — a leaf
cohort belongs to one Term, but its parent programme persists across all of
them and can't be owned by one. Unlinked = visible in every Term
(fail-open, deliberately, opposite of this codebase's usual instinct).
Backfill derived from actual usage (`offering_group ∪ session_group`), not
guessed; ancestors not auto-scoped.

**The solver's Group filter is reference-derived, not scope-derived — the
load-bearing decision.** Filtering by `group_term` (tenant *configuration*)
could disagree with what Offerings actually reference, producing an
internally-inconsistent `SolverInput` the solver can't detect. The sent set
is the referenced ids' conflict closure (`{g} ∪ ancestors ∪ descendants`),
closed by construction — pinned by an assembly-time assertion, 600
randomised hierarchies against an independent oracle, and a falsification
test. `group_term` is never allowed near solver input — it exists purely
for picker UX. Scoping a Group out of a Term that still uses it warns
after the write (`role="status"`, not `alert`) rather than blocking, since
nothing breaks (reference-derived). DECISIONS.md § "Group↔Term scoping".

## Bootstrap & deploy sequence

```
1. migrate deploy    schema only — tables, RLS, triggers, indexes. No rows.
2. db seed           reference data (permission catalogue).
3. provision:tenant  first tenant, its admin, baseline constraints.
4. start the app
```

- **Local**: `docker compose ... up -d db`, `bun run db-seed`, `bun run
  provision:tenant -- --slug … --name … --admin-email … --admin-name …`.
- **CI/containers**: entrypoints run `migrate deploy` then `db seed` —
  `migrate deploy` does NOT auto-seed (only `reset`/`dev` do); this step
  must not be removed.
- **`db-reset`** replays migrations and seeds automatically.
- **A new permission needs a 4th step** — seed doesn't touch
  `access_role_permission` (would be silent privilege escalation).
  Backfill: `bun run grant:permissions -- --role tenant-admin --all-missing`.
- **A constraint SEVERITY change needs a backfill BEFORE/WITH the deploy,
  never after** — `toWireConstraint` reads the catalogue's severity, not
  the row's; a HARD row (`weight = NULL` by CHECK) ships as weight 0 under
  a SOFT catalogue entry, silently disabled. Repair: `bun run
  backfill:constraints -- --retype <key>` (rewrites severity+weight in one
  statement, the CHECK pairs them).
- **A rebuilt dev DB has one role/account** — see Operator CLIs above.
- **Production image**: `node:22-alpine`; toolchain installs against a
  generated minimal manifest (not the real `package.json`, which hits a
  peer conflict); `bun` copied from `oven/bun:1-alpine`; registry
  credential reaches the build as a BuildKit secret, never in image
  history. Five blockers behind this: DECISIONS.md.
- **CI**: BuildKit needs `secret-files` not `secrets` (file path vs.
  inline value); `PACKAGES_READ_TOKEN` must be a classic PAT. Smoke step
  asserts `/health` and a non-empty `permission` table.

**The helper schema is `calendry_internal`, never `calendry`** — naming it
after the owner role would let Postgres's default `search_path` capture
Prisma's own `_prisma_migrations` table, created before any migration SQL
runs, silently misplacing every table.

**The solver runs as a compose service** (vendored submodule at
`vendor/calendry-solver`, its own nested `calendry-proto` submodule — use
`--init --recursive`). `CALENDRY_SOLVER_ADDR` means BIND on the solver
(`0.0.0.0:50051` in-container) and CONNECT on the app; `solverAddress()`
picks in-container vs. `_HOST` by testing `/.dockerenv`. Always `docker
compose up -d` bare — a partial service list won't start what it doesn't
name.

**Two database URLs, one database** — `MIGRATION_DATABASE_URL` (compose-
network) vs. `_HOST` (published port), selected the same `/.dockerenv` way
by `ownerDatabaseUrl.ts`/`prisma.config.js`. The runtime app role never
needs either (SELECT-only on `tenant`, can't create tenants).

## TimeGrid breaks

`time_grid.break_minutes` is the default gap; `time_grid_break` adds sparse
`{afterBlockIndex, durationMinutes, label, dayOfWeek}` overrides
(`dayOfWeek NULL` = every day, a day-specific row wins at that position
only). `shared/timeGrid.ts`'s `blockTime()`/`blockOfMinute()` are the
single definition of block boundaries — disagreeing would mean the
schedule renders one time while `reference_slot` believes another. **Breaks
never reach the solver** (verified: `toWireTimeGrid()` omits them, test
asserts the omission) — the wire carries block indices only.
`fitsGrid()`'s criterion is the index space (`blocksPerDay × activeDays`),
deliberately ignoring breaks; the same guard blocks narrowing the grid
under an existing Session and gates the move route. Orphaned breaks are
deleted+reported; orphaned Sessions refuse the edit (DATA vs.
CONFIGURATION asymmetry).

**OPEN QUESTION** — a Session whose duration spans a break: undecided,
deliberately, see **[BACKLOG.md](BACKLOG.md) § Undecided**. One branch
would overturn "breaks never cross the wire."

## `MinimizeBlockUsage`

Replaced `MinimizeFirstBlock`/`MinimizeLastBlock` (booleans baked to fixed
`SlotFlags` positions, silently wrong when a TimeGrid's day extends) with
`{ blocks: number[], first: bool, last: bool }` — `calendry-proto@0.4.0`.
Old fields kept `deprecated` not removed (`buf breaking` forbids removal;
existing tenant rows still need to render/edit, `type` is `createOnly`).

## Things to never do without asking first

- Add/rename/restructure a fixed taxonomy entity
- Hardcode a tenant-open value (role name, kind, equipment tag) into logic
- Bypass the event log for a Session mutation
- Implement solver logic in this repo
- Relax tenant isolation beyond the three declared exceptions above
