# CLAUDE.md — Calendry

Read this at the start of every session. It holds **rules**: things that break if
undone, stated once. The reasoning, measurements and incident records behind them
live in `DECISIONS.md` — read the named section there before changing anything a
rule here covers.

## What this project is

Multi-tenant timetabling for schools and universities, across three repos:

- **`calendry`** — this repo. Nuxt. Entities, database, CRUD, auth,
  import/export. Owns Postgres.
- **`calendry-solver`** — Rust, gRPC, **stateless**. Offerings + Constraints →
  near-optimal Session placement (LNS + simulated annealing; a 27,000-Session
  instance solves in ~250 ms). Vendored at `vendor/calendry-solver` purely so
  `docker compose up` builds the whole stack from one checkout. **Never author
  solver logic here** — it belongs in that repo, and comes back as a submodule
  pointer.
- **`calendry-proto`** — the shared schema. Consumed *here* as the npm package
  `@mindcollaps/calendry-proto` (**GitHub Packages**, not npmjs.org), and by the
  Rust side as its own nested submodule at
  `vendor/calendry-solver/vendor/calendry-proto`.

Rule of thumb: generating or optimising a schedule is the solver's job; managing,
storing and presenting one is this repo's.

## Where things are written down

| File | Holds |
|---|---|
| `TAXONOMY.md` | The fixed entity model. Authoritative — changes are migrations, not config edits. |
| `CLAUDE.md` | **Durable rules.** Target 200–300 lines. State a fact once; link the reasoning. |
| `DECISIONS.md` | **Archive.** Why a decision was taken, what was measured, how a bug was found. |
| [Project board](https://github.com/users/MindCollaps/projects/4) | **Transient, and the SOURCE OF TRUTH for open work.** Bugs, deferred work, undecided questions. Not in the repo, so nothing offline can check it — see the note below. |

Dividing question: what must not be undone (→ CLAUDE.md), the no-longer-live
story behind it (→ DECISIONS.md), or what someone might still do (→ the board)?

**`BACKLOG.md` was retired on 2026-08-28** and its contents migrated to the
board. One property was lost with it and cannot be recovered offline: the board
is not readable by a test, so nothing mechanically checks the landing page's
roadmap against reality any more. `app/utils/landingContent.ts` is now the single
source of those claims and `tests/landing-page.test.ts` pins the page to it — so
page and module cannot drift, but module and reality can. **Moving a card to Done
on the board therefore includes editing `BUILT`/`NEXT` in that file, in the same
change.** That used to be a test failure; it is now a rule, which is strictly
weaker, so it is written here.

**The board's status field must change in the same session as the work it
describes, not as a follow-up.** It is the source of truth named above, and
nothing offline checks it against reality (no test can — it isn't in the
repo), so a card left stale is invisible until someone reads the actual code
behind it and finds the two disagree. That happened on 2026-08-31: a whole
family of solver-parity constraint type issues had shipped — catalogue entry,
wire assembly, and config UI, verified end to end with a live wire-assembly
smoke test — while the board still called every one of them "Partial done."
Finishing a card's work includes flipping its status (and, where the issue
body tracks phases like "Solver: done" / "App: not yet reachable", updating
that body to match) before moving on — never leaving it for a later audit.

## Fixed vs. open taxonomy

**Fixed** (schema-level, changing = migration): Federation, Tenant, Person,
Group (nestable), Room, Offering, Session, TimeGrid, Term, Constraint,
Membership, Assignment.

**Open** (tenant-managed vocabulary, changing = data): Role names,
Equipment/Feature tags, Offering/Session `kind` values, Constraint parameter
values. **Never hardcode an open value into logic** — never assume a Role called
"Student" or a `kind` called "lecture"; resolve against tenant config.

## Architecture rules

- **Multi-tenant, isolated by default.** Every tenant-scoped table carries
  `tenant_id`; RLS enforces it at the DB layer, not just in app code.
- **Runtime connects as the non-owner role.** `DATABASE_URL` uses `calendry_app`
  (owns nothing, `FORCE ROW LEVEL SECURITY`). `MIGRATION_DATABASE_URL` (the
  owner) is for the Prisma CLI and provisioning only. Pointing the app at the
  owner silently disables every RLS policy and every test still passes. Never do
  it.
- **Never query outside `withTenant()`.** Route handlers go through
  `withRequestTenant`. A query outside it sees zero rows, not all rows —
  deliberate. Sole exception: `server/utils/authDb.ts`.
- **Migrations are schema-only; seed populates data.** A freshly migrated
  database is deliberately unusable: `permission` is empty and provisioning fails
  loudly on the `access_role_permission` FK.
- **Never regenerate `prisma/migrations/`.** Hand-written RLS, triggers,
  functions and indexes cannot be expressed in `schema.prisma`, so
  `prisma migrate dev` emits a migration that silently DROPS them — every table
  still exists, isolation is gone, tests still pass. Rebuild with `db-reset`.
  `db-drop` (`db push --force-reset`) is the same hazard, kept only as an
  explicit escape hatch — never to rebuild a working database.
  § "Database & migrations".
- **The history is ONE squashed migration** (`20260812000000_init`), assembled
  pre-1.0 by CONCATENATING the 32 that built it — never regenerated, for the
  reason above. Squashing again is fine and follows the same method; a test
  asserting a statement exists must read the migrations DIRECTORY
  (`tests/helpers/migrations.ts`), never a path, and must scope its match to the
  statement it means: over the whole DDL, `is_enabled` matches a column
  declaration and every migration's own prose matches its comments.
- **`prisma migrate reset` does NOT run the configured seed**, whatever
  `prisma.config.js` says — so `db-reset` calls `db-seed` itself. Undo that and
  a rebuilt database is left with an empty `permission` table, and the next
  `provision:tenant` fails on the `access_role_permission` FK naming neither.
- **The helper schema is `calendry_internal`, never `calendry`** — naming it
  after the owner role lets Postgres's default `search_path` capture Prisma's own
  `_prisma_migrations` table and silently misplace every table.
- **History is event-sourced.** Manual edits are append-only events
  (`create`/`move`/`swap`/`delete`/`lock`) on a versioned Generation snapshot;
  never mutate a Session without emitting the event. The trigger permits one
  exception: an UPDATE nulling `session_id`/`counterpart_session_id` and nothing
  else, so a Session can be deleted without destroying its audit trail.
- **Nested Groups propagate conflicts both directions** (ancestor ↔ descendant).
  Read TAXONOMY.md §6 before touching conflict-check code, and never walk the
  tree live in a hot path — use the precomputed closure.
- **TimeGrid is per-tenant, not global.** Never hardcode block or timeslot
  arithmetic; resolve against the tenant's TimeGrid and Term config.
- **Locked Sessions are solver-exempt** — a re-run skips them entirely.
- **Hard-constraint violations from manual edits: warn, don't block** — surfaced
  as queryable state, not a one-time toast.
- **Timezone is per-Person and display-only** — never affects grid resolution,
  constraint evaluation, or "same day" logic. All of that is tenant-local time.

### Three principals, and only one can hold a permission

`RequestIdentity` is a discriminated union — `kind: 'account' | 'screen' |
'system'` — matching the three ways a request arrives: a human with a session
cookie, a lobby display with a device key, and the background poller.

**Only `account` has an acting Person, and that is the whole authorization
model.** `heldPermissions()` throws 403 when `actorPersonId` is null, so a screen
key and the poller cannot satisfy ANY permission check — including ones added
later by somebody who has never heard of screens. A device's authority is its own
scope (`ScreenIdentity.roomIds`) and nothing else, enforced at the one route that
reads it.

Never give a non-account principal an `actorPersonId` to make a check pass. The
check is the boundary; widen the route deliberately, or add a scope the way
screens did.

### The three deliberate exceptions to tenant isolation

Conscious boundaries, not oversights. **A fourth is a bug** — do not add one
without a comparably strong reason.

1. **Federation-owned resources.** `room`/`equipment`/`offering`/`session` may be
   Federation- instead of Tenant-owned (a shared lecture hall, a cross-enrolled
   elective). A CHECK enforces exactly one owner; RLS read widens to the
   federation, write stays tenant-only.
2. **The pre-tenant auth plane.** `account`/`account_person`/`auth_session` carry
   **no RLS** — a session must be read before the tenant is known. Replaced by
   access shape: read only by PK or unique token hash from a verified cookie,
   never by tenant filter. Tenant-scoped auth lookups go through
   `SECURITY DEFINER` functions (`calendry_internal.session_identity()` /
   `account_identities()`), parameterised solely by a secret, never a tenant id.
3. **The background solver poller.**
   `calendry_internal.tenants_with_due_solver_runs()` runs when nobody is logged
   in, so `current_tenant_id()` is NULL. Returns **tenant ids only**, no
   parameters; every write happens inside an ordinary `withTenant()` transaction.

## The traps that keep recurring

Each of these has bitten more than once, in a different disguise each time.

- **Guards must fail loudly or match exactly.** A condition that can both
  "correctly find nothing" and "match nothing because of a bug" must be
  distinguishable — anchored matching, asserted shape, or a reported action. The
  counter-example to copy: provisioning an unseeded database fails on a FK and
  writes nothing. Case log: § "Guards must fail loudly".
- **If "no data" and "fetch failed" render identically, the bug is invisible.**
  The general form of the rule above, and the reason for the next three.
- **SSR fetches must use `useRequestFetch()`, never bare `$fetch`** — `$fetch`
  drops the browser cookie server-side, so an authenticated call 401s and the
  page renders its empty state, indistinguishable from an unconfigured tenant.
- **Vue does not flush watchers during SSR.** `watch(data, seed, { immediate:
  true })` runs once, before the fetch resolves, and never again. First-render
  state must come from the awaited promise; the watcher is for later client
  refreshes. Prefer `computed` over a watcher-assigned `ref`, and verify rendered
  *content*, not element presence. Case log: § "SSR/watcher bugs".
- **`/api/[resource]` switches response shape on `limit`** — no `limit` gives a
  bare array, `limit` gives `{ rows, total }`; `[relation].put.ts` takes a bare
  array as its **body**. Three bugs in one hour came from assuming the envelope,
  and typecheck saw none: `request<T>()` is an unchecked assertion about what the
  server sends, so a wrong `T` is a lie the compiler believes. Read the route;
  pin a new consumer with a test that CALLS it
  (`tests/group-availability-api.test.ts`).
- **A tracked-gap entry can drift from the code silently.** Prose is checked by
  nobody. Before acting on an entry here or on the board, confirm its claim
  against the code — and measure, if it is about performance. Applies with more
  force to the board, which nothing references and so nothing contradicts: the
  migration off `BACKLOG.md` found one entry claiming the permission model had no
  row-level self-scoping, months after `session.read_own` shipped.
- **`--fix` tooling rewrites files outside your scope, and needs the project's
  own config.** Scope the fixer to your paths and `git checkout --` anything
  else. A bare `stylelint <file>` resolves a *different* ruleset than
  `bun run stylelint`, so fixing against it introduces warnings under the real
  one. § "`--fix` tooling".
- **`export { x } from './y'` does not bind `x` locally** — throws
  `ReferenceError` if the same file also calls `x`, and `nuxt build` typechecks it
  clean. Import what you re-export if you still use it.
- **`<select>` needs `:selected` on `<option>`**, not just `:value` on the
  select — `value` is a property, dropped by SSR, and the browser falls back to
  the first option.

## Conventions

### TypeScript

- **No `any`, no unnarrowed `unknown`.** Every signature and boundary concrete
  enough that `nuxt build`'s typecheck means something. A genuinely unknown
  boundary value (webhook body, JSON column, external API) is typed `unknown` and
  narrowed immediately via Zod or a type guard. `strict: true` is a floor; a
  wrong rule at one call site gets a scoped `eslint-disable-next-line` with a
  reason, never a blanket loosen.
- `tsconfig.json` adds `noUnusedLocals`, `noUnusedParameters`,
  `noFallthroughCasesInSwitch`. Prefer `satisfies` when a literal needs both
  inference and a shape check; prefer a discriminated union over optional-field
  soup, so `switch` chains exhaustiveness-check.

### Naming and routes

- **`Offering`** is the recurring definition; **`Session`** is one placed
  occurrence. No "Lecture"/"Event"/"Class" as entity names — those are
  tenant-facing `kind` values.
- Standard REST per entity, but editing operations
  (`move`/`swap`/`lock`/`apply-generation`) are **explicit verbs on Session**,
  not generic PATCHes, so the event log records intent.
- **`/` is the PUBLIC landing page; `/dashboard` is the signed-in home.**
  `auth.global.ts` has two non-interchangeable exemption lists: `PUBLIC_ROUTES`
  (auth pages — need no session AND bounce a signed-in visitor) and
  `ANONYMOUS_ROUTES` (`/` — needs no session, bounces nobody). `HOME_ROUTE` in
  `app/utils/routes.ts` is the **only** place "where a signed-in session belongs"
  is written. `/` reads no session, calls no API, exposes no tenant data.
- **The landing page's claims live in `app/utils/landingContent.ts`** and
  `tests/landing-page.test.ts` asserts the page renders exactly them. The contact
  CTA is `mailto:`, not a POST: persisting it would be a fourth RLS exception.

### Components and styling

- **Split a component past ~3 responsibilities or ~250 lines** — the line count
  is a trigger to look, not a rule (cohesive SCSS bulk is fine). Pages compose,
  they do not implement; a composable owns one boundary.
- **A composable calling `useAsyncData`/`useRequestFetch` must stay
  synchronous** — an `await` inside detaches it from the Nuxt instance ("called
  outside a Vue setup function"). Return the handle; hold the top-level `await`
  in the page.
- **New style work uses design tokens, never literals** — colours from
  `--<colorName>` (per-theme via `useLayout()`), sizing from
  `--font-size-*`/`--radius-*`/`--space-*` in `app/scss/tokens-root.scss`. Add a
  token deliberately if one is genuinely missing.

### Permissions

- **Per-tenant, tenant-configured roles** — never a hardcoded global role enum.
- **Permissions are fixed, roles are not.** The catalogue is code —
  `shared/permissions.ts`, where `PERMISSIONS` is CRUD keys derived from
  `CRUD_RESOURCES` plus an explicit list. Tenants bundle them into AccessRoles
  but cannot invent them. **`prisma/seed.ts` mirrors the catalogue into the
  `permission` table on every deploy**, reporting created/updated and naming any
  row that exists in the database but not in code — so adding a permission is a
  one-file change, not a migration. (This said "mirrored by a migration" until
  2026-08-28; no migration has ever inserted a permission row, and following it
  would have meant writing one that does nothing.) Granting is still a separate
  step — see Bootstrap & deploy.
- **`Role` (TAXONOMY.md §2, scheduling vocabulary) and `AccessRole` (§4,
  authorization) share a word and are different things.** Never merge them;
  never grant permissions via `Role`.
- **A page must not depend on permissions its own gate doesn't imply.**
  Enumerate every endpoint a page calls: one missing permission inside a
  `Promise.all` blanks the whole page with no error, the least diagnosable
  failure a UI has.
- **A nav entry's gate is the section's authority, never the endpoint's** — and
  the two are allowed to differ. Gating anything on `session.read` ("may view the
  timetable") silently offers it to everyone who can see a schedule; that put the
  institution's own settings and every solver proposal in a lecturer's
  navigation. Ask "whose data is this?", not "who happens to be looking at it?" —
  § "`tenant.read` and `generation.read`".
- **`NavEntry.permission` is an AND of ORs** (`PermissionRequirement`): a bare
  string is one key, a flat list is ALL, a nested list is ANY.
- **A filter exists when it has more than one option — never because of a
  permission.** Its options come from what the caller can already see, so the
  option list IS the boundary. An active filter always renders regardless.

## Solver integration

**The solver never touches Postgres.** This app assembles a complete
`SolverInput` and sends it; every gap in that snapshot is a wrong answer the
solver has no way to detect.

- **Only the move budget is reproducible.** `(input, seed, move budget)` →
  byte-identical output, but only when `termination_reason` is `move_budget` or
  `converged`; a comparison drawn across two `time_budget` runs is not evidence.
  `maxMoves` default **30,000,000**, wall-clock cap **30 s** to keep the move
  budget binding. § "Solver: determinism & `maxMoves`".
- **Idempotency key is `<inputHash>:<scopeHash>:<seed>`** — SHA-256 of each
  *encoded* message, not JSON. **Both halves are needed**: `SolverInput` carries
  no scope, so keying on it alone made a repair and a rebuild of one unchanged
  term the same key, and the registry replayed the rebuild's answer for the
  repair. The budget is in NEITHER, so restart the solver between measurements at
  different budgets or you will replay the first run. The registry is in-memory,
  so a stable key also replays across a code change.
- **A run's mode decides its scope, its lock policy AND its movement weight —
  derive all three together.** `resolveScope()` in `server/utils/solverScope.ts`
  is the only place; a `rebuild` defaults to every active Offering under
  `LOCK_POLICY_HARD`, a `repair` to an EMPTY scope under
  `LOCK_POLICY_MINIMIZE_MOVEMENT`, which is what makes every Session movable and
  every move cost. Writing the policy out at a call site is how it came to be
  hardcoded twice, once into the stored JSON and once onto the wire.
- **Never assert a proto message's shape with `as`.** ts-proto interfaces
  require every field; a cast turns that check into a claim, and a field added by
  a proto bump then compiles clean and throws `"<field> is not iterable"` from
  `encode()` at runtime. v0.10.0 did exactly this twice (`Room.feature_quantities`,
  `Session.room_ids`). Construct checked, and let typecheck name the new field.
- **Warn-and-allow parity**: a `SUCCEEDED` run with residual hard violations is
  still an applicable Generation — not discarded, not auto-applied, and
  `GenerationStatus.INFEASIBLE` is consequently unused for solver output.
  § "Solver: warn-and-allow".
- **A poll failure is not a run failure.** `NOT_FOUND` (gRPC 5) means the solver
  lost the run: terminal, row → `FAILED`. Anything else, including `UNAVAILABLE`,
  is transient and leaves the row untouched. Concurrency is enforced by a partial
  unique index, not `findFirst`. §§ "Solver: Stage 2", "Solver: Stage 4 polling".
- **`violations.ts`: membership flows DOWN, conflict flows BOTH WAYS.**
  `attendeeSets` uses `descendantGroupIds`, `conflictSets` uses
  `conflictGroupIds`. Swapping either reintroduces an under- or over-reporting
  bug that looks correct on any flat fixture.
- **Per-person preferences are live end to end.** A NULL `weight_multiplier` is
  sent as ABSENT, never 0 — proto3's zero is itself a meaningful multiplier. The
  solver charges the **mean over a placement's lecturers of `multiplier ×
  unmet`**; `PersonPreferenceFit.roles` must stay EMPTY — `[]`, not `{}` — or the
  run is refused. Lecturers-only is a DECIDED scope, not a gap: widening it needs
  a per-role normalisation rule first, because a Session's attendee set is the
  whole descendant closure. Solver ADR-0026; §§ "Per-person preferences",
  "`PersonPreferenceFit.roles`".
- **Tracked wire-format gaps** (on the board) each report rather than
  narrow silently — do not "fix" one by picking a value: the solver's unbounded
  run registry, violations naming solver-invented Sessions with no join key.
  **Equipment quantity and multi-room Sessions were on this list and are not
  gaps any more** — both are sent and enforced end to end. The list is prose,
  which nothing checks, so it is exactly the entry this file warns can drift:
  confirm a gap against the code before acting on it.

Installing the proto package (three causes of the same opaque 401), the operator
CLIs, the test accounts, and constraint-shape validation at the write boundary:
§ "Solver & proto: operational detail".

## Data-model rules by area

Boundaries already drawn wrong once. The two below are cross-cutting — anyone
might reach for the wrong one without going near that feature:

- **`group_term` is a visibility scope, never a scheduling input.** Unlinked
  Group = visible in every Term (fail-open). The solver's Group filter is
  **reference-derived**, not scope-derived: the sent set is the referenced ids'
  conflict closure, so it cannot disagree with what Offerings reference.
  § "Group↔Term scoping".
- **`group_term_availability` is the opposite table; never merge them.** It says
  WHEN INSIDE a Term a Group is available, and exists to reach the solver as
  `Group.blackouts`. Adding those dates to `group_term` is the obvious move and a
  trap: row existence there means "only these Terms", so a window would silently
  scope the Group OUT of every other Term. Absent row = whole Term. Stored
  POSITIVE, sent NEGATIVE — `blackedOutWeeks()` is the only place that flips, and
  week granularity rounds toward AVAILABLE. § "Group availability windows".

The rest are area-specific: read the section before working in that area.

| Area | The rule in one line | Record |
|---|---|---|
| Schedule permissions | `sessionReadScope()` is the single definition of "visible"; `/api/sessions` and `/api/schedule/context` must agree exactly. "My own" walks the closure **UP**. | § "`session.read_own`" |
| Accounts | `accounts` is NOT in `CRUD_RESOURCES` (no `tenant_id`, no RLS). Visibility IS the join; `assertSoleTenant` / `assertDetachable` are exact complements. | § "Accounts in the management area" |
| `/manage` | One scaffold from `manageRegistry.ts`, which is also the nav source. Bespoke means one slot, never a page. `custom: true` or the field is dropped from saves silently. | § "Management area" |
| Display settings | Singleton keyed by `tenant_id`, absent row = defaults. Colour is RESOLVED and may be **null** — never a fallback accent. | § "Schedule display" |
| TimeGrid breaks | Never reach the solver — a multi-block Session spanning one is LEGAL, drawn honestly, never sent. `blockTime()`/`blockOfMinute()`/`gapsWithinSpan()` are the single definition of block boundaries and of what a span does not teach. | §§ "TimeGrid breaks", "A Session that spans a break" |
| Calendar periods | `classifyWeeks` is the one classifier; `EXAM` touches the week, `BREAK`/`HOLIDAY` cover it. | § "Academic calendar periods" |
| Week grids | Minute-true, rows grow, a slot stays IN FLOW, placement is px at a constant scale. Nothing is ever hidden. | § "Grid geometry" |
| Schedule toolbar | Height is invariant; the solver's tall states are anchored panels. `.bar_select` is capped. | § "The schedule toolbar" |
| Screens | A lobby display is a DEVICE credential, not a fourth RLS exception: resolved by secret alone through `screen_identity()`, then ordinary `withTenant()`. Key hashed, shown once, generated in the browser. Empty room scope = every room. | § "Screens" |

## Bootstrap & deploy sequence

```
1. migrate deploy    schema only — tables, RLS, triggers, indexes. No rows.
2. db seed           reference data (the permission catalogue).
3. provision:tenant  first tenant, its admin, baseline constraints.
4. start the app
```

- **Local**: `docker compose ... up -d db`, `bun run db-seed`, then
  `bun run provision:tenant -- --slug … --name … --admin-email … --admin-name …`.
- **CI/containers**: entrypoints run `migrate deploy` then `db seed` —
  `migrate deploy` does NOT auto-seed (only `reset`/`dev` do). Do not remove that
  step. `db-reset` replays migrations and seeds automatically.
- **The solver runs as a compose service.** Clone with `--init --recursive`.
  `CALENDRY_SOLVER_ADDR` means BIND on the solver (`0.0.0.0:50051` in-container)
  and CONNECT on the app;
  `solverAddress()` picks in-container vs. `_HOST` by testing `/.dockerenv`.
  Always `docker compose up -d` bare — a partial service list won't start what it
  doesn't name.
- **Two database URLs, one database** — `MIGRATION_DATABASE_URL`
  (compose-network) vs. `_HOST` (published port), selected the same
  `/.dockerenv` way by `ownerDatabaseUrl.ts` / `prisma.config.js`. The runtime
  app role needs neither.

Three kinds of change are **themselves migrations**:

- **A new permission** — seed does not touch `access_role_permission` (that would
  be silent privilege escalation). `bun run grant:permissions -- --role
  tenant-admin --all-missing`.
- **A permission that MOVES**, which is worse: the backfill only repairs
  `tenant-admin`, so a hand-composed role holding the old key silently loses the
  capability and nothing reports it. Grep tenants' `access_role` grants first.
- **A new constraint type, or one gaining a `wireField`.** A new type needs
  `backfill:constraints -- --all-missing` or nobody can enable it. A `wireField`
  appearing silently changes the timetable of every tenant that had already
  enabled that rule — the dev tenant had `person_preference_fit` on for the whole
  period it could not cross the wire. Grep `constraint_def` for enabled rows
  first — `defaultConstraintRow` only decides what a NEW tenant seeds, which is
  no protection once somebody has enabled a rule. A **severity** change needs
  `--retype <key>` BEFORE or WITH the deploy, never after: `toWireConstraint`
  reads the catalogue's severity, not the row's, so a HARD row (`weight = NULL`)
  ships as weight 0 under a SOFT entry — silently disabled.

Owed by any tenant provisioned before them: `account.read`, `account.manage`,
`tenant.read`, `tenant.update`, `generation.read`, `session.read_own`,
`screen.read`, `screen.manage`, `exam.request_own`, `exam.review`,
`session.assign_lecturer`, the `member` role, and a `group_veto` constraint
row.

**`exam.request_own` is the one that wants granting to LECTURERS, not just to
`tenant-admin`.** `grant:permissions --all-missing` repairs the admin role only,
which for every other key on this list is the whole intent — this one is useless
there and inert everywhere else until somebody adds it to the role real
lecturers hold.

Production image and CI specifics: § "Bootstrap & deploy".

## Things to never do without asking first

- Add, rename or restructure a fixed taxonomy entity
- Hardcode a tenant-open value (role name, `kind`, equipment tag) into logic
- Bypass the event log for a Session mutation
- Implement solver logic in this repo
- Relax tenant isolation beyond the three declared exceptions
- Let a tenant change a credential on an Account another tenant also uses, or
  leave an Account with no `account_person` row
