# CLAUDE.md — Calendry

Read this file at the start of every session. It's the persistent context —
TAXONOMY.md is the taxonomy source of truth; this file is everything else you
need to work in this repo consistently across sessions.

## What this project is

Calendry is a multi-tenant calendar/timetabling platform for schools and
universities. It has two major parts, built in sequence:

1. **Calendar management app** (this repo, Nuxt) — entities, database, CRUD
   and editing routes (move/swap/lock Sessions), multi-tenant auth, import/
   export. Built first.
2. **Solver** (separate repo/service, Rust) — takes Offerings + Constraints,
   searches for a near-optimal Session placement via hybrid constructive +
   local-search optimization. Built second, called via a service contract
   from this app. **Not implemented in this repo** — only the interface
   boundary lives here.

If you're not sure whether something belongs in this repo, ask: does it
generate/optimize a schedule (solver's job, elsewhere) or manage/store/
present one (this repo's job)?

## Source of truth documents

- `TAXONOMY.md` — the fixed entity model and terminology. Authoritative.
  Do not add, rename, or restructure core entities without flagging it and
  getting explicit confirmation first — this is intentionally "carved in
  stone" and changes here are migrations, not config edits.
- This file (`CLAUDE.md`) — the **durable** half: architecture rules, RLS
  boundaries, standing conventions, and the reasoning behind decisions someone
  could otherwise undo. Update it when a real convention changes; don't let it
  drift from reality.
- `BACKLOG.md` — the **transient** half: open bugs, deferred work, undecided
  questions, the phase checklist. Split out on 2026-08-23 so this file stops
  absorbing both categories.

  The dividing question is *does this tell someone what not to undo, or what
  they might still do?* A resolved bug whose fix encodes a real decision stays
  HERE, under "Resolved, with the reasoning kept" — deleting it would delete the
  argument, not the bug. Anything actionable goes to BACKLOG.md.

## Fixed vs. open taxonomy (quick reference)

**Fixed** (schema-level, changing = migration): Federation, Tenant, Person,
Group (nestable), Room, Offering, Session, TimeGrid, Term, Constraint,
Membership, Assignment.

**Open** (tenant-managed vocabulary, changing = data): Role names, Equipment/
Feature tags, Offering/Session `kind` values, Constraint parameter values.

Never hardcode an "open" value into application logic (e.g. never assume a
Role called "Student" exists, never assume a `kind` called "lecture" exists)
— always resolve against tenant configuration.

## Architecture rules

- **Multi-tenant, isolated by default.** Every tenant-scoped table carries
  `tenant_id`; isolation is enforced at the DB layer (row-level security),
  not just in application code.
- **The runtime must connect as the non-owner role.** `DATABASE_URL` uses
  `calendry_app`, which owns nothing and is subject to `FORCE ROW LEVEL
  SECURITY`. `MIGRATION_DATABASE_URL` (the owner) is for the Prisma CLI and
  the provisioning script only. Pointing the app at the owner would silently
  disable every policy in the system — the owner is a superuser and bypasses
  RLS entirely — and *every test would still pass*. Never do it.
- **Migrations are schema-only; data population is seed-only.** A migration may
  create tables, policies, triggers and indexes — never rows. Reference data
  lives in `prisma/seeds/` and is applied by `prisma db seed`. This keeps DDL
  history a record of structure, and lets reference data be corrected without
  inventing a migration whose only content is an `UPDATE`. It also means **a
  freshly migrated database is not yet usable**: the `permission` table is
  empty, and provisioning a tenant against it fails on the
  `access_role_permission` foreign key. That failure is deliberate and loud.
- **Never regenerate `prisma/migrations/`.** The RLS/trigger migration is
  hand-written and cannot be reproduced from `schema.prisma` — the schema
  language cannot express row-level security, triggers, `SECURITY DEFINER`
  functions or partial indexes. `prisma migrate dev` will cheerfully emit an
  "equivalent" migration containing none of it, producing a database where every
  table exists and tenant isolation is silently absent, with every test still
  passing. Rebuild with `prisma migrate reset`, which *replays* the committed
  files.

  **`db-reset` ran `migrate dev` until 2026-08-23, and that — not the old
  `rm -rf prisma/migrations` — is what actually caused the damage this rule
  exists to prevent.** The script was
  `migrate reset --force && migrate dev --name init && generate`. `reset`
  replays correctly; `migrate dev` then diffs `schema.prisma` against the
  rebuilt database, sees hand-written objects the schema language cannot
  declare, and emits a migration to DROP them. That is the exact provenance of
  `20260813190131_init`, which contains nothing but three `DROP INDEX`
  statements and is applied. This entry previously said "`db-reset` used to
  `rm -rf prisma/migrations`; it no longer does" — true, and misleading, because
  the removed half was never the dangerous one.

  `migrate dev` is now gone from the script (`migrate reset --force && generate`).
  The consequence worth holding onto: **any hand-written index, policy, trigger
  or function is invisible to `schema.prisma` and was therefore a standing
  candidate for deletion on every developer's next rebuild.** If those three
  indexes had been recreated rather than measured and declined, the next
  `db-reset` would have dropped them again.

  `db-drop` (`prisma db push --force-reset`) is the same hazard in sharper form
  and is deliberately left in place as an explicit escape hatch: `db push`
  applies `schema.prisma` DIRECTLY, so it produces a database with every table
  and **no RLS, no triggers, no `SECURITY DEFINER` functions** — tenant
  isolation silently absent, every test passing. Never use it to rebuild a
  working database; `db-reset` is the rebuild path.
- **Never query outside `withTenant()`.** Route handlers go through
  `withRequestTenant`, which opens a transaction and sets
  `calendry.tenant_id`. A query issued outside it sees zero rows rather than
  all rows; that failure mode is deliberate. The sole exception is
  `server/utils/authDb.ts` — see below.

### The two deliberate exceptions to tenant isolation

Both are conscious boundaries, not oversights. Anything that looks like a
third exception is a bug.

1. **Federation-owned resources.** `room`, `equipment`, `offering` and
   `session` may be owned by a Federation instead of a Tenant (a consortium's
   shared lecture hall, a cross-enrolled elective, a genuinely shared event
   both member tenants see). A CHECK constraint enforces exactly one owner,
   and the RLS read policy widens to the caller's federation while the write
   policy stays tenant-only. See "Group↔Term scoping" and the Federation
   sections below for the reasoning behind extending this to `session`
   specifically, and why it deliberately did NOT extend to `group`/`person`.

2. **The pre-tenant auth plane.** `account`, `account_person` and
   `auth_session` carry **no RLS at all**. This is structural, not a
   shortcut: a session must be read *before* the tenant is known, because the
   session is what determines the tenant — any policy on these tables would
   compare against a context that does not exist yet and would reject every
   login. What replaces RLS is access shape: they are only ever read by
   primary key or unique token hash from a verified cookie, never by tenant
   filter, and no route exposes them. `server/utils/authDb.ts` is the only
   module permitted to query without tenant context.

   Where auth genuinely needs tenant-scoped data (resolving a session's
   Person to its Tenant), it goes through the two `SECURITY DEFINER`
   functions `calendry_internal.session_identity()` and
   `calendry_internal.account_identities()`. Both are parameterised solely by a
   secret the caller already holds and neither accepts a tenant id, so neither
   can be coaxed into enumerating another tenant.

3. **The background solver poller.** `calendry_internal.tenants_with_due_solver_runs()`
   (Stage 4). Added under the same rule as the two above, for the same reason:
   the operation structurally sits OUTSIDE the tenant-request model rather than
   being made easier by skipping it. Auth must read a session *before the tenant
   is known*; the poller runs *when nobody is logged in at all*, so
   `current_tenant_id()` is NULL and the app role sees zero rows in both
   `solver_run` and `tenant` — fail-closed working exactly as designed, and
   leaving a cross-tenant job unable to see the work it exists to do.

   What keeps it narrow: it returns **tenant ids only** — no run rows, no
   scopes, no inputs, no results — and takes **no parameters**, so it cannot be
   steered at a chosen tenant. Everything the poller then does happens inside an
   ordinary `withTenant()` transaction under RLS, including the claim and every
   write. Widening it to return the runs themselves was considered and rejected:
   it would move the atomic claim into SQL and carry run data across the
   boundary to save one round trip per tenant per tick.

These three are the **only** RLS-bypassing code paths in the system. Do not add
a fourth without a comparably strong reason — and "the query is awkward
otherwise" is not one.
- **Nested Groups propagate conflicts.** A booking conflict on a parent
  Group blocks its descendants and vice versa. Availability checks must
  walk the ancestor/descendant closure, not do a flat lookup. See
  TAXONOMY.md §6 before touching any conflict-check or notification
  fan-out code — there's a known perf trap here (don't walk the tree live
  in hot paths; use a precomputed closure structure).
- **`group_term` is a visibility scope, never a scheduling input.** A Group
  can be many-to-many linked to the Terms it's relevant to; an unlinked Group
  is visible in every Term (fail-open). The solver's own Group filter never
  reads this table — see "Group↔Term scoping" below for why that's load-bearing,
  not incidental.
- **TimeGrid is per-tenant, not global.** Never hardcode block/timeslot
  arithmetic (e.g. `timeslot % 3`, `timeslot > 14` for "Saturday"). Always
  resolve against the tenant's TimeGrid and Term/academic-calendar config.
- **History is event-sourced.** Manual edits are append-only events
  (`create`/`move`/`swap`/`delete`/`lock`) applied on top of a versioned
  Generation snapshot (solver output or manual baseline). Never mutate a
  Session in place without emitting the corresponding event — rollback and
  audit depend on the log being complete.

  **What the solver path does and does not log, deliberately.** Applying a
  Generation writes ONE `APPLY_GENERATION` event, not one per placement — the
  snapshot is the record, and a 27,000-Session apply would otherwise write
  27,000 rows. The exception is **deletion**: `executePlan` emits a `DELETE`
  event per removed Session, because a removal is the one change a snapshot of
  what-now-exists cannot describe. Until 2026-08-23 it emitted none, so "what
  was removed, and from where" had no answer at all.

  Order matters there and is easy to get wrong: the event is written **before**
  the row is deleted. `session_event.session_id` is `ON DELETE SET NULL` and the
  append-only trigger permits exactly that detach (migration `20260816180000`),
  so the pointer is nulled while the payload keeps the placement. Writing the
  event afterwards would produce a row pointing at nothing, indistinguishable
  from the detached case.
- **Locked Sessions are solver-exempt.** A solver re-run must skip locked
  Sessions entirely, not just deprioritize them.
- **An offering-less Session is an EVENT, and its exemption is structural, not
  the lock.** `session.offering_id` is nullable (TAXONOMY.md §2); NULL means a
  human placed this and no recurring demand stands behind it.
  `planMaterialization()`'s delete partition requires `inScope.has(offeringId)`,
  and an Event belongs to no Offering, so no solve's scope can reach it —
  including a solve that has never heard of it. `POST /api/sessions` also
  defaults `is_locked` to true, but **the lock is defence in depth**: it is one
  UPDATE from being cleared, whereas the missing Offering is a property of what
  the row IS. Verified against a live solver both ways, locked and unlocked.

  **Deleting one is Events-only, and that boundary is load-bearing.**
  `DELETE /api/sessions/:id` refuses an Offering-linked Session with 409: its
  Offering declares a frequency, so deleting the Session leaves that unmet and
  the next solve re-creates it — the delete would appear to work and silently
  undo itself. Removing a real Session means deciding whether it is re-placed or
  held as unplaced-but-tracked, which is the deferred cancel-to-spare-bank
  feature. 409 rather than 404 so "belongs to an Offering" stays distinguishable
  from "no such Session".

  Two consequences that must not be "tidied":

  - the delete partition names `offeringId === null` as its own clause rather
    than relying on `Set.has(null)` being false — an exemption that works but is
    invisible would break silently the moment `inScope` changes shape;
  - `toWireSession` forces `isLocked` for an Event exactly as it already does
    for a federation-shared Session, so the solver receives it as **occupancy**
    and never proposes moving something the apply would refuse to write.
- **Hard-constraint violations from manual edits: warn, don't block.** The
  UI/API must surface current violations as a queryable state, not just a
  one-time toast at edit time.
- **Timezone is per-Person and display-only.** It must never affect grid
  resolution, constraint evaluation, or "same day" logic — those all run in
  tenant-local time.

## Conventions

- **Naming**: `Offering` = recurring definition/demand; `Session` = one
  atomic placed occurrence. Don't use "Lecture," "Event," or "Class" as
  entity names in code — those are tenant-facing `kind` values, not schema
  concepts.
- **Routes**: CRUD follows standard REST conventions per entity. Editing
  operations (`move`, `swap`, `lock`, `apply-generation`) are explicit verbs
  on the Session resource, not generic PATCHes, so the event log can record
  intent, not just a diff.
- **Guards and detection conditions must fail loudly or match exactly.** Never
  write a check whose failure mode is a silent no-op indistinguishable from the
  correct case. If a condition can both "correctly find nothing" *and*
  "incorrectly match nothing because of a bug", those two states must be
  distinguishable — by anchored/exact matching, by asserting the expected shape,
  or by reporting what it did.

  This has bitten repeatedly, in different disguises:

  - An unauthenticated SSR fetch rendered the schedule's *empty state*, so a
    broken request looked exactly like a legitimately unconfigured tenant.
  - `'DATABASE_URL_HOST=' in text` matched `MIGRATION_DATABASE_URL_HOST`, so an
    idempotency guard skipped the write it was protecting and reported success.
    Fixed with an anchored `^\s*DATABASE_URL_HOST=`.
  - `concept-seed.mjs` exits 0 printing nothing when its state directory is
    wrong, which reads identically to "no findings".
  - **Array truthiness (Stage 6b).** `GET /api/solver/runs` returns `active` as
    an ARRAY, and `[]` is truthy, so `list.active ?? list.runs[0]` always
    yielded the empty array. Run adoption therefore never fired and the toolbar
    reported "no run in progress" — which is exactly what it says when there
    genuinely is none. Fixed with `active?.[0]`. In JS the empty-collection case
    needs `.length` or an index, never a bare truthiness test.
  - **Absence that only proves the page failed (Stage 6b).** The first
    permission check asserted the solver control was missing for a viewer — and
    it was also missing for the admin, because of the SSR bug below. A test for
    "affordance absent" must also assert the surrounding page RENDERED, or it
    passes for the wrong reason. The fixed check reports
    `schedule rendered=True solver control=False`.
  - **A constraint tracked against a query shape that never existed (indexes,
    below).** Two of three "missing" indexes were tracked as backing a
    `refreshViolations()` collision lookup that has never driven off room/person
    columns. The description was accurate to an intention, not to the code.

  The counter-example to copy: provisioning against an unseeded database fails
  on a foreign key and writes nothing. Loud, specific, unmistakable.

- **A tracked-gap entry written from design INTENT can drift from the code
  silently — re-verify before acting on one.** Everything else in this repo is
  checked by something: types, tests, the database, the build. Prose is checked
  by nobody. So an entry describing what a thing is *for* stays confidently
  worded long after the implementation went somewhere else, and the next session
  reads it as fact because it is written like fact.

  The instance that proved it: the three missing indexes below were tracked as
  backing "the room/person collision lookups in `refreshViolations()`", copied
  from the migration comment that created them. `refreshViolations()` has
  never looked up by room or person — it drives off `session_id` throughout, and
  the primary keys already served it. The description was accurate to an
  intention the code never took, and reading it as a to-do would have added two
  indexes with `idx_scan = 0` at 27,000 sessions.

  Practical form: when a tracked entry is the reason you are about to change
  something, **confirm its claim against the code first, and measure if the claim
  is about performance.** Then correct the entry with what you found, whichever
  way it went — that is how the entry stops being wrong, and the correction is
  worth more than the change you were going to make. A periodic pass over the
  older entries is tracked in `BACKLOG.md`; until then, verification is
  per-entry and happens when the entry is used.

  **This applies with more force to `BACKLOG.md` than to this file.** Nothing in
  the repo references a backlog entry, so nothing ever contradicts one when it
  goes stale — no test fails, no build breaks, no reader trips over it in the
  course of other work. CLAUDE.md at least gets read every session. Treat an
  entry there as a lead, never as a finding.

- **Split a component when it mixes more than ~3 distinct responsibilities, or
  exceeds ~250 lines.** Line count is the trigger to *look*, not the rule: a
  single-concern component that is large because of cohesive SCSS
  (`CommonButton`, 303 lines) is fine, while a 300-line file juggling fetching,
  filter state and four presentational blocks is not. **Pages compose; they do
  not implement.** State moves to a composable when more than one component
  needs it, or when it forms a machine with its own rules (selection and
  placement mode constrain each other, so they live together). Give each
  composable one ownership boundary and say what it is — `useScheduleFilters`
  owns exactly what changes the API query, and view state like density stays out
  of it precisely because it does not.

  One Nuxt-specific trap this ran into: **a composable that calls `useAsyncData`
  or `useRequestFetch` must stay synchronous.** An `await` inside it detaches
  everything after that point from the Nuxt instance and fails at runtime with
  "a composable ... was called outside of a Vue setup function". Return the
  async-data handle and let the page hold the single top-level `await`.

- **New style work uses design tokens, never literals.** Colour, font size,
  border radius and spacing come from CSS custom properties: colours from the
  generated `--<colorName>` set (emitted per-theme by `useLayout()`), sizing from
  `--font-size-*`, `--radius-*` and `--space-*` (declared once in
  `app/scss/tokens-root.scss`, with SCSS aliases in `app/scss/tokens.scss`).
  Either form works — `$fontSizeMd` and `var(--font-size-md)` are the same
  property. This applies to **new** components and styles from Step 10 onward;
  existing hardcoded literals are backlog and no step needs to hunt them down as
  a side effect. If a value genuinely has no token, add one to the scale
  deliberately rather than reaching for a literal.

- **SSR data fetches must use `useRequestFetch()`, never bare `$fetch`.** Inside
  `useAsyncData` (or any server-side render path), `$fetch` does not carry the
  browser's cookie, so every authenticated call 401s on the server. The damage
  is that this does not look like an error: the page renders its *empty state*
  and hydrates from that, so a broken fetch is indistinguishable from a
  legitimately unconfigured tenant. `useRequestFetch()` forwards the incoming
  request's headers. Corollary when designing empty states: if "no data" and
  "the fetch failed" render the same way, the bug is invisible — distinguish
  them.

- **`--fix` tooling can rewrite files outside the current change's scope —
  review the full diff for unexpectedly-touched files, not just the ones you
  meant to change.** `stylelint --fix` and `eslint --fix` operate on whatever
  their config globs match, which is the whole project, not your working set.

  Concrete instance, Step 13: `bun run stylelint:fix` was run to clean up new
  components and silently modified **8 files the step never touched** — five
  schedule components, `schedule.vue`, `layout.scss` and `schedule-panel.scss`.
  Most of it was harmless property reordering, but it also rewrote
  `rgba(124, 89, 188, 0.55)` → `rgb(124, 89, 188, 0.55)` in `ScheduleGrid.vue`,
  a *value* change inside the file whose grid placement had just been debugged.
  It was caught by reading `git diff --name-only`, not by any check — build,
  typecheck, eslint and all 45 tests passed with it in place.

  Practical form: scope the fixer to your own paths
  (`stylelint --fix 'app/components/manage/**/*.vue'`), and when you do run it
  project-wide, `git checkout --` the files outside your scope afterwards.
  Bulk-fixing pre-existing lint debt is a deliberate standalone task, never a
  side effect of another step.

- **`export { x } from './y'` re-exports WITHOUT binding `x` locally.** The
  module can hand `x` to its importers and still throw `ReferenceError: x is not
  defined` when its own code calls it — and `nuxt build` typechecks it clean,
  because the export is genuinely valid. Moving `isoWeekday` into
  `shared/academicCalendar.ts` and re-exporting it from `solverCalendar.ts` broke
  `computeReferenceSlot()` exactly this way; three tests caught it, the build did
  not. When extracting a helper that the same file still uses, `import` it as
  well as re-exporting it.

- **Vue does not flush watchers during SSR, so nothing that must be true at
  first render may depend on one.** A `watch(data, seed, { immediate: true })`
  runs exactly once on the server — at setup, before the fetch resolves — and
  never again. In Step 13 that rendered every management edit form with *empty
  inputs* over records that had data; the client re-seeded on hydration, so it
  showed as a flash and a hydration mismatch rather than an error. Drive
  first-render state from the awaited promise instead
  (`const ready = (async () => { await asyncData; seed(); })()`), and keep the
  watcher only for later client-side refreshes.

  It survived a whole phase because the check counted `<input>` elements rather
  than reading their `value`. **Verify the content, not the presence.**

  **Second instance, Stage 6b — same shape, different symptom.** `filters.termId`
  is seeded by a `watchEffect` in `useScheduleData`, so during SSR it is still
  `''` while the page renders. The solver control gated on it
  (`v-if="canTriggerSolver && termIdModel"`) and was therefore absent from the
  server-rendered page for a user who had every permission for it, appearing only
  after hydration. Fixed by exposing `resolvedTermId` — which falls back to the
  term the fetch actually used — and gating on that instead.

  The generalisation, now that this has happened three times (edit forms,
  `<select>`, this): **anything a watcher seeds is `undefined` at first render on
  the server.** If a template branches on it, the server renders the wrong branch.
  Prefer a `computed` derived from the awaited data over a watcher-assigned `ref`
  whenever first render depends on the value.

- **`<select>` needs `:selected` on its options, not just `:value` on the
  select.** `value` is a *property* of a select element, not an attribute, so
  server rendering drops it and the browser falls back to the first option. A
  Term that had a TimeGrid rendered as "— None —" until hydration corrected it:
  the page stating the opposite of the truth. Every `<select>` in
  `app/components/manage/` binds `:selected` on its `<option>`s for this reason.

- **Permissions**: per-tenant, tenant-configured roles — never a hardcoded
  global role enum in application logic.
- **`Role` and `AccessRole` are different things that share a word.** `Role`
  (TAXONOMY.md §2) is scheduling *vocabulary* — Lecturer, Student, Auditor —
  and carries domain meaning: `offering.required_role_id` means "this Offering
  needs a Lecturer". `AccessRole` (§4) is *authorization*: a tenant-defined
  bundle of fixed Permissions. Keeping them separate is what stops the schema
  accepting an Offering that requires a lecturer holding the role "Billing
  Admin". Never merge them, and never grant permissions via `Role`.
- **A constraint TYPE with no row is a silently disabled rule, not a neutral
  absence.** `refreshViolations()` evaluates only the types the tenant has a
  `constraint_def` row for, and `constraint_violation.constraint_id` is NOT
  NULL, so a type nobody created is a rule that never runs and never says so.

  This bit for real and for a long time: `no_double_booking_person` was added to
  the catalogue in Stage 7a and never added to `provision-tenant.ts`'s
  hand-written three-item list, so the person-clash check had **never run in any
  real tenant** — while `tests/violations-person-clash.test.ts` passed the whole
  time, because it creates its own constraint row.

  Closed structurally (TAXONOMY.md §2 amendment): every tenant now holds exactly
  one **default row per live catalogue type**, enforced by the partial unique
  index `constraint_one_default_per_type` on `(tenant_id, type) WHERE is_default`.
  Provisioning derives the set from `CONSTRAINT_TYPES` rather than listing it,
  so a new type is provisioned by construction; existing tenants are repaired
  with `bun run backfill:constraints -- --all-missing`.

  Three things to keep:

  - **A tenant opts out by DISABLING a default row, never by deleting it.**
    Deleting makes the rule unreachable again; disabling makes it off.
  - **Deprecated types get no default row** (`defaultConstraintTypes()` filters
    on `deprecatedBy`). They stay in the catalogue so existing rows remain
    renderable, but seeding a fresh one would resurrect a superseded rule as a
    first-class option. Two are deprecated today, so the catalogue has 15
    entries and **13 live types**.
  - **The grid renders from the CATALOGUE, not from the fetch.** A type with no
    row is reported loudly in the UI rather than omitted — omission is exactly
    what hid the gap above, in a list that looked complete.

- **Two or more Groups on an Offering means N independent series, not one
  combined Session.** TAXONOMY.md §2 states the rule and why it was always the
  intended meaning. The mechanics worth knowing here:

  - **The solver needs no knowledge of it.** A multi-group Offering is split
    before assembly into one wire Offering per Group, id
    `` `${offeringId}::${groupId}` ``, each with the full frequency and its own
    capacity. `convert.rs` keys everything by wire id and echoes it back, so N
    series are indistinguishable from N hand-made rows.
  - **The mapping is ENCODED, not held in a side map.** Materialization runs at
    APPLY, from `solver_run.result`, possibly days later and across a restart —
    anything held in memory during assembly is gone by then. Reversal lives in
    `parseWireOfferingId` and is called from exactly two places (the placement
    path and the violation path); an id that cannot be reversed is counted, not
    guessed.
  - **Scope is stored in TWO languages.** `solver_run.scope.offeringIds` keeps
    REAL ids because `planMaterialization` compares them to
    `session.offering_id`; `wireOfferingIds` carries the split ids the solver is
    given. One list for both breaks in one direction or the other — wire ids
    stored means nothing is ever deleted, real ids sent means nothing is ever
    placed.
  - **Existing Sessions must be re-pointed or omitted.** `convert.rs` resolves an
    existing Session's Offering by matching `offering_id` against wire ids, and
    uses it for scope, `already_realized` and id reuse. A Session left on its
    real id after a split becomes immovable out-of-scope occupancy that counts
    toward no series — so the solver would place the full frequency again ON TOP
    of it. A Session carrying exactly one of the Groups is re-pointed at that
    series; a legacy COMBINED one (none or several) is omitted from the wire
    entirely and removed by the apply, counted in
    `report.legacyCombinedSessionsOmitted`.
  - **No Offering rows are ever created.** Every resulting Session points at the
    one real `offering_id`, with `session_group` carrying only that series'
    Group.

  Measured on the demo tenant: 12 Offerings became 48 wire entries, required
  capacity fell from 96 to 24 per series, and a solve that previously had to put
  all 65 Sessions online with 4 `MaxOnlineShare` violations produced 260
  Sessions across the three physical rooms with zero violations.

- **A non-default Constraint must name a scope, and scoping is KIND-ONLY in the
  UI.** Every live catalogue type has a default (tenant-wide) row, so a second
  UNSCOPED row of the same type is not an "additional rule" — it is a second
  tenant-wide rule with its own weight, and both reach the solver. That is the
  duplicate-constraint defect this project already fixed once, and the "Add
  scoped variant" button reintroduced it by creating rows it had no way to
  scope: `GET /api/constraints/:id/scopes` returned `[]` and nothing in the UI
  could change that.

  Three things hold it together, and each was chosen against an alternative:

  - **Scopes travel in the constraint's own payload** (`childKeys: ['scopes']`),
    not as a relation. `ManageRelationsPanel` cannot edit relations before the
    row exists, so "create then scope" would leave a window in which the variant
    IS the duplicate. Same mechanism `time-grids` uses for `breaks`.
  - **`beforeCreate` refuses an unscoped variant when a default exists, and
    `beforeUpdate` refuses an edit that would empty the scopes.** Guarding only
    create would let the same state be reached in two requests. This cannot be a
    database constraint — "has at least one row in another table" is not a CHECK,
    and the partial unique index governs only how many DEFAULTS exist.
  - **The "exclude types that already have a default" alternative is unworkable
    by construction**: all thirteen live types have one, so the picker would be
    empty.

  **Kind scopes only in the form.** `constraint_scope` can name an Offering and
  the relation endpoint still accepts one, but `assembleSolverInput` SKIPS a
  constraint scoped to offerings outright — `ConstraintConfig` carries
  `applies_to_kinds` and nothing else, and sending it unscoped would widen the
  rule rather than narrow it. An offering picker would be a control whose main
  effect is switching the rule off in the next solve.

  Note also that **`refreshViolations()` ignores scopes entirely**, so scoping a
  structural rule narrows the SOLVER's view and not the live violation checks.

- **Editing an EVENT is `POST /api/sessions/:id/details`, and it is Events-only.**
  Title, kind, groups and people; placement and room stay on `move`, which
  already owns them (`setRooms()` posts `roomIds` there). Adding room here would
  mean two routes writing `session_room` under two permissions emitting two
  event types.

  Offering-linked Sessions are refused with 409 for the reason DELETE refuses
  them: `kind_id` is copied from the Offering and groups/people come from solver
  output, so a manual edit would be silently overwritten by the next apply.

  `fitsGrid()` is deliberately NOT checked here — the route touches no placement
  field, so a grid guard could never fail, and this codebase treats a guard that
  cannot fail as worse than none.

  The event type is `UPDATE_DETAILS`, not a generic `UPDATE`: the routing
  convention above exists so the log records intent, and the payload carries
  `before`/`after` for the CHANGED fields only.

- **A per-entity API route must NOT live under `server/api/<resource>/` for a
  resource served by the generic scaffold.** `server/api/[resource]/` is the
  CRUD catch-all; creating a literal sibling directory makes Nitro match that
  segment statically and stop considering the dynamic branch, so **every** route
  for that resource 404s. Measured while adding the derived-capacity endpoint:
  `GET /api/offerings` returned "Page not found" while `/api/rooms`,
  `/api/groups` and `/api/persons` stayed 200 — the whole Offerings section
  dead, from adding one unrelated file. The endpoint lives at
  `/api/offering-capacity/:id` for exactly this reason.

- **`Offering.requiredCapacity` derives when NULL — really, now.** Both the
  schema comment and the form's help text promised derivation from the attached
  Groups; nothing derived, `assembleSolverInput` mapped `?? 0`, and the solver's
  filter is `room.capacity < min_capacity`, so 0 admitted every Room. Measured
  on the demo tenant: twelve Offerings of 96 attendees each, all with NULL, all
  placed into 24-seat rooms.

  The rule lives once, in `shared/groupCapacity.ts`, because two consumers need
  the identical number: the solver input and the Offering form's read-only note.

  **Counting is a UNION, not a sum**, and that is the whole design. Two
  independent double-counts exist — a person enrolled at both a leaf and an
  ancestor (legal data), and an Offering carrying both a Group and one of its
  own descendants. Both are fixed by taking the union of every attached Group's
  own-plus-descendants closure and counting DISTINCT people. The `expectedSize`
  fallback needs the same dedup, so it sums only the MAXIMAL attached Groups:
  "IT Security" (48) plus its child "dIT22 S1" (24) is 48, not 72 — verified
  live in both the membership and estimate forms.

  **Real membership always beats `expectedSize`**, including when it is smaller —
  an enrolment list is a fact and an estimate is a number someone typed once.
  The consequence: a PARTIAL roll shrinks the requirement. Enrol 4 of 96 and the
  derived capacity is 4, measured rather than hypothesised.

  That is not blocked, because the roll is still the honest count. It is
  REPORTED: `report.offeringsWithPartialEnrolment` carries `{ members, expected }`
  whenever the roll is below `ENROLMENT_COMPLETE_RATIO` (0.9) of the estimate,
  and the Offering form says so next to the field. Three things about that
  threshold are deliberate:

  - **It is not zero-tolerance.** A roll is always slightly short — late
    enrolment, drops — so flagging any shortfall would fire on nearly every
    Offering and train people to skip the report.
  - **It decides only WHETHER to mention it, never severity.** Both numbers
    travel, so 4-of-96 and 86-of-96 both surface and are obviously different
    problems. A slightly-wrong threshold degrades into noise, not silence.
  - **No estimate means no flag.** Absence of an `expectedSize` anywhere in the
    closure is not evidence of completeness, and inventing a comparison would be
    the silent-narrowing failure one level up.

  **Underivable is reported, not silently zero.** The wire field is a plain
  uint32 with no absent case, so 0 is still sent — but the Offering lands in
  `report.offeringsWithNoDerivableCapacity` beside the other narrowings. The bug
  being fixed was the silence, not the zero.

- **Permissions are fixed, roles are not.** The `permission` catalogue is code
  (`server/utils/permissions.ts`, mirrored into the table by migration).
  Tenants bundle permissions into AccessRoles; they cannot invent permissions,
  because a permission with no corresponding code path is meaningless. Adding
  one means editing both the constant and the migration.

## Current phase

Tracked in **[BACKLOG.md](BACKLOG.md) § Current phase**, together with the
staged solver plan. Kept out of this file because a checklist is a task list,
not a decision someone could undo.


## Solver integration (calendry-solver)

Three repos, one system. Neither of the other two is checked out as part of
this one:

| Repo | What it is | How this app consumes it |
|---|---|---|
| `calendry` | this app — owns Postgres, all state | — |
| `calendry-solver` | Rust gRPC optimizer, **stateless** | over gRPC |
| `calendry-proto` | the shared Protobuf schema | npm package `@mindcollaps/calendry-proto` |

The solver is functionally complete: all 14 constraint types from the §7
catalogue, LNS with simulated annealing, and a `StartRun`/`GetStatus`/`CancelRun`
job API. A 27,000-Session large-university instance solves in ~349ms.

**The solver never touches Postgres.** This app assembles a complete
`SolverInput` snapshot and sends it; the solver is input/output only and
persists nothing beyond an in-flight run. Everything the solver knows, this app
put in the request — which means every gap in the snapshot is a wrong answer the
solver has no way to detect.

`calendry-proto` is consumed here as a normal npm dependency and by the Rust
side as a pinned git submodule. It is published to **GitHub Packages, not
npmjs.org**, which requires authentication to install even though it is public.

### Installing the proto package: three traps, all hit for real

The credential lives in `~/.bunfig.toml` (or the gitignored `./bunfig.toml`),
never in a committed file. `bun run check:registry-auth` diagnoses all of this
offline; `bunfig.toml.example` is the template. Each rule below cost a round
trip to discover, and all three produce the *same* opaque 401:

1. **A bunfig scope token is only sent when the SAME entry declares `url`.**
   `{ token = "…" }` alone is silently ignored — even with the scope mapped to
   the right registry in `.npmrc`. Verified against a local probe registry that
   logged the `Authorization` header.
2. **An `.npmrc` auth line OVERRIDES a bunfig scope token.** A stale, invalid
   token left in `~/.npmrc` kept beating a perfectly good `bunfig.toml` entry;
   `curl` with the same good token succeeded the whole time. If bun 401s while
   curl works, look for a second credential before doubting the first.
3. **GitHub Packages rejects fine-grained PATs for the npm registry.** A
   `github_pat_…` token authenticates fine against `api.github.com` (200) and is
   then refused by the registry with `permission_denied: does not match expected
   scopes`, and by the packages REST API with `Resource not accessible by
   personal access token`. Use a **classic** PAT (`ghp_` + 36 chars) with
   `read:packages`. The guard now catches this by prefix.

Scope entries resolve nearest-first and the nearest wins **wholesale** — a
project-level entry replaces a home entry rather than merging with it — which is
why nothing scope-related is committed.

### Decision: warn-and-allow parity for solver output

A run that reaches `RUN_STATUS_SUCCEEDED` but still carries residual hard
violations **is still offered as an applicable Generation.** Its violations are
surfaced through the same `constraint_violation` mechanism manual edits already
use. Not silently discarded, not auto-applied.

`Generation.apply` still requires an explicit human action regardless of
violation state — unchanged from existing behaviour.

**A consequence, realised in Stage 5: `GenerationStatus.INFEASIBLE` is now
effectively unused for solver output, and that is not an oversight.** Warn-and-
allow means a SUCCEEDED run carrying residual hard violations is still `READY`
and still applicable, and a run that never succeeded produces no Generation at
all (`shouldCreateGeneration()` admits only SUCCEEDED — a Generation nobody can
apply is noise in a list whose entire job is "what could I apply?", and
`solver_run` already records what happened). The status stays in the enum for
import and for a future solver that reports infeasibility as a first-class
outcome. Nothing setting it is the design working, not a missing branch.

This is parity with §3's manual-edit rule (hard-constraint violations warn, they
do not block), and it matches what the wire protocol already says: `RunStatus`
deliberately describes **the run's lifecycle, not the solution's quality**. The
solver accepts possibly-infeasible input and degrades gracefully rather than
rejecting it, exactly as `ExactFrequency` (unplaced Sessions) and
`MaxOnlineShare` (share breaches) already do. A `SUCCEEDED` run with violations
is a normal outcome, not an error case.

### Decision: single-tenant, non-federated scope for Stages 1–6

**Superseded by Stage 7 for two of the two mechanisms below — both are now
implemented.** Kept here for the reasoning; see "Federation-shared room
occupancy" and "Federation-shareable Sessions" further down for what actually
shipped.

Two Federation mechanisms were decided in principle and deliberately NOT
implemented before Stage 7:

- **`ExternalOccupancy`** — occupancy of Federation-shared Rooms by other
  tenants. Resolved in Stage 7b (below): a parameterless `SECURITY DEFINER`
  function, not a cross-tenant ledger.
- **`Session` becoming federation-shareable** — resolved in Stage 7c (below):
  the Session row is shared, but participant links (`session_group`,
  `session_person`) stay tenant-private — a deliberate narrowing of the
  TAXONOMY.md amendment's literal wording.

### Determinism: only the move budget is reproducible

`Budget` carries both `max_wall_millis` and `max_moves`, and **whichever is hit
first ends the run**. The guarantee is that the same `(input, seed, move budget)`
produces byte-identical output — but that holds **only when termination was by
move budget**. A wall-clock-terminated run is not reproducible, because how many
moves fit in a second is not a property of the input.

`SolveStats.termination_reason` reports which one ended it (`"move_budget"`,
`"time_budget"`, `"converged"`, `"cancelled"`). Anything that claims to explain,
replay or diff a run must read that field first; treating a `time_budget` run as
replayable produces a different answer and blames the wrong thing.

`StartRunResponse.seed` echoes the seed actually used (0 = solver picks one), so
a run is reproducible even when the caller did not choose the seed.

### Idempotency: the key is `<inputHash>:<seed>`

`POST /api/solver/runs` sends a SHA-256 of the ENCODED `SolverInput` plus the
seed as `StartRunRequest.idempotency_key`, so **a repeated start against
unchanged data returns the SAME run rather than launching a second one.**
Observed accidentally and then confirmed deliberately: two consecutive
assemblies of the demo tenant produced an identical hash and the solver handed
back the same `run_id`.

Two things to know before changing it:

- The hash is over the encoded protobuf, not a JSON rendering. Two inputs that
  encode identically are the same problem to the solver, which is exactly the
  question being asked; a JSON hash would also move with key order and with how
  BigInt happened to stringify.
- Anything that deliberately changes the problem MUST change the key, or the
  solver returns the earlier run and the new one is never observed. This bit
  during Stage 3 verification: a stress variant reused the key and silently got
  the previous, easy run back.

### Both of the above are now CONFIRMED, not just designed

Measured in Stage 1 against a live `calendry-solver`, not inferred from the
proto:

- **Determinism.** Two runs of an identical snapshot at seed 42 produced
  byte-identical placements, objective and termination reason. Note a third
  terminal reason beyond the two in the guarantee: `converged`, when the
  constructive heuristic lands a zero-objective solution in 0 moves. It is as
  reproducible as `move_budget`; `time_budget` remains the one that is not.
- **Warn-and-allow is the solver's actual behaviour.** An over-constrained
  snapshot (60 sessions demanded into a 40-slot grid) returned
  `RUN_STATUS_SUCCEEDED`, `termination_reason=move_budget`, objective 21, **40
  placements and 2 `ExactFrequency` hard violations** — rather than failing the
  run. Stage 5 can rely on this: a SUCCEEDED run carrying violations is normal,
  and the residuals arrive in `SolverOutput.hard_violations` ready to be mapped
  onto `constraint_violation`.

### Staged plan

All seven stages are complete; the table has moved to
**[BACKLOG.md](BACKLOG.md) § Staged plan** as a changelog. What each stage
*established* — the behaviours and decisions that outlive it — stays in the
sections below.


### What Stage 2 established, and the one path it could not test

Three behaviours were verified against a live solver rather than reasoned about:

- **Concurrency is enforced by the database.** Three simultaneous POSTs to the
  same term returned one 201 and two 409s naming the winner. The rule is the
  partial unique index, not a `findFirst` — two parallel requests would both
  pass an application check and both insert.
- **A failed StartRun resolves its own row.** Solver down → 502, row `FAILED`,
  **zero** active runs. The row is written as `PENDING` *before* StartRun so the
  index can reject a concurrent second attempt during the call, which creates
  the obligation to resolve it; otherwise a solver outage blocks that term until
  someone edits the database by hand.
- **A poll failure is deliberately NOT a run failure.** `GET /runs/:id` with the
  solver down leaves the status untouched and returns `stale: true`. Marking it
  `FAILED` would destroy a live run's record *and* free the index for a second
  concurrent run.

Two traps found while building it, both worth not rediscovering:

- **A 23505 aborts the Postgres transaction.** Nothing may query it afterwards.
  Looking up the conflicting row inside the same transaction returned
  `500 current transaction is aborted` instead of a clean 409 — and only a
  genuinely *parallel* test surfaced it; a sequential one passed.
- **ts-proto emits `uint64` as `string`, not bigint.** `toWireU64` /
  `fromWireU64` in `solverClient.ts` are the only place that conversion happens.

**`RUNNING → CANCELLED` — RESOLVED in Stage 3b/3e.** It was tracked here through
Stage 2 because `CancelRun`'s already-terminal and never-acknowledged paths both
passed, so cancel *appeared* to work from every route tested, while the run that
matters — a genuinely in-flight one — had never been interrupted.

Now verified twice: directly against the solver, and through
`POST /api/solver/runs/:id/cancel` (`RUNNING`, 6.2M moves, objective 1095 →
`cancelled=true` → `CANCELLED`).

Note what it took, because it will recur: the demo tenant's REAL data still
converges in ZERO moves — 48 sessions into 760 slots is not a search problem —
so the transition only became observable after demand was raised far above
capacity. Anything that needs to watch a run in flight must construct that
deliberately.

### Stage 4: how polling actually works, and three things worth not relearning

**The background poller owns correctness; on-demand polling owns latency.**
`GET /api/solver/runs/:id` exists so someone watching gets a fast answer, but
nothing about a run reaching a terminal state may depend on a human keeping a
tab open. Both call the same `pollSolverRun()`, so they cannot disagree about
what a status means.

**Results are captured the moment a run goes terminal**, not when someone asks
to apply them. The solver's run registry is an in-memory map with no persistence
and no eviction, so "I'll fetch it later" is a promise a restart breaks.
`solver_run.result` makes Stage 5 a database→database transform that cannot fail
because a service bounced.

**NOT_FOUND and UNAVAILABLE mean opposite things** and the distinction is the
sharpest edge in Stage 4:

- `NOT_FOUND` (gRPC 5) — the solver restarted and lost the run. Terminal and
  unrecoverable: the row is marked `FAILED` with that reason, which also frees
  the one-active-run index for that term.
- anything else, including `UNAVAILABLE` (14) — transient. The row is left
  **completely untouched** and the caller is told `stale: true`. Marking it
  failed would destroy a live run's record on a blip *and* let a second
  concurrent run start against the same term.

`classifyPollFailure()` errs toward `unreachable` for unrecognised codes: the
cost of being wrong that way is a stale row, the other way is a destroyed one.

**Claiming is a lease, not a lock.** The original design used a session-scoped
`pg_try_advisory_lock` to elect a single poller. That was wrong twice over and
was caught before building: session locks belong to a CONNECTION and Prisma
pools connections, so the "leader" would not reliably hold anything; and holding
it across the gRPC calls would keep a transaction open across a network call —
exactly what Stage 2 refused to do for StartRun.

What actually works: a short transaction pushes `next_poll_at` into the future
for the rows it takes, using `FOR UPDATE SKIP LOCKED`, so concurrent instances
take **disjoint** sets rather than serialising. `pg_try_advisory_xact_lock`
remains, scoped tightly around the claim and released at COMMIT before any
network call, purely to stop a same-tenant stampede. Verified: four concurrent
claimers, six due runs, zero duplicate claims, and the work becomes claimable
again once the lease expires — so an instance dying mid-poll strands nothing.

**One consequence to expect:** during a solver outage the effective retry
interval is the 30s claim lease, not the adaptive cadence, because a failed poll
deliberately writes nothing at all. A run therefore takes up to ~30s after the
solver returns to resolve. That is backoff, not a bug, but it surprised me while
testing and will surprise the next person.

### Tracked gaps in the wire format

Three open expressiveness limits between this app and `calendry-proto`, all in
**[BACKLOG.md](BACKLOG.md) § Solver**: equipment QUANTITY cannot cross the wire,
a Session with more than one Room cannot be represented, and the solver's run
registry grows without bound. Each reports rather than narrows silently
(`assembleSolverInput`'s report, `multiRoomSessionIds()`), which is the property
to preserve — **do not "fix" any of them by quietly picking a value.**


### RESOLVED (cross-repo): the solver treated a VIRTUAL room as capacity-1

Both halves are now exempt, and the two sides agree. Fixed in `calendry-solver`
at `99b41e3`; `vendor/calendry-solver` points at it.

`Occupancy` (`solution.rs`) held a binary `BitMatrix` over (rooms × slots) with
no capacity dimension, and `check_pair`'s `RoomDoubleBooking` branch reported on
`rx == ry` — neither consulting `is_virtual`. The solver's half was the damaging
one because it constrained the SEARCH: one online Session per slot, tenant-wide,
during construction and LNS both.

The fix keys on the FLAG, via a single `Room::is_exclusive()` predicate that both
layers consult, so the search cannot refuse a placement it then declines to
report. `capacity` still gates eligibility and was deliberately left alone — a
virtual room with a genuine concurrency limit still cannot be expressed, and
needs an explicit `concurrentCapacity` rather than an overload of `capacity`.

**It exposed a real gap in the solver, which is now tracked there rather than
here.** The bug had been enforcing `MaxOnlineShare` by accident: virtual rooms
are the overflow valve when physical rooms are full, and capacity-1 held that
valve nearly shut. Removing it more than doubled share violations at
large-university (180 → 455) with structural violations unchanged at exactly 80
and `unplaced` still 0 — so the model is now correct and the search is visibly
worse at respecting a cap it was never actually respecting on its own. That is
solver-side work; nothing in this app changes because of it. See
BACKLOG.md § "Needs a decision, not a design pass" for the candidate fixes.

What this app should expect in the meantime: a SUCCEEDED run may carry more
`MaxOnlineShare` violations than it used to. That is warn-and-allow behaving as
designed — they arrive in `SolverOutput.hard_violations` like any other residual
— but a run against a tenant with heavy online delivery will look noisier than
the Stage 5 measurements recorded above.

### Why `violations.ts` expands membership DOWN but conflicts BOTH ways

Two opposite failure directions were found in the same function, and the fix for
each is why the two directions are now deliberately different. Both are closed —
this is the reasoning, not a gap.

**Under-reporting (closed by Stage 7a).** `no_double_booking_lecturer` intersects
`session_person` rows, so it catches a person assigned to two overlapping
Sessions directly — and misses one clashed in via membership of two *unrelated*
Groups, where `conflictGroupIds()` connects nothing. `no_double_booking_person`
closes it by expanding both sides to their attendee sets (direct participants
plus every DESCENDANT group's members) and intersecting by identity.

**Over-reporting (closed in Stage 5).** The group check expanded the conflict
closure of BOTH sides, so any two Groups sharing an ancestor always intersected
at that ancestor — see the Stage 5 section below for the measured scale.

The rule that falls out, and the thing not to "simplify" back: **membership flows
DOWN, conflict flows BOTH WAYS.** Being in Seminar A1 makes you part of Class A's
cohort; being in Class A does not put you in Seminar A1. So `attendeeSets` uses
`descendantGroupIds` while `conflictSets` uses `conflictGroupIds`, and swapping
either for the other reintroduces one of the two bugs above.

### Stage 5: two pre-existing bugs it uncovered, both fixed

Neither was introduced by Stage 5. Both had gone unnoticed for the same reason —
nothing had ever exercised the code path — and both are the kind of thing
CLAUDE.md's "guards must fail loudly or match exactly" rule exists to catch.

**1. A Session with history could not be deleted at all.**

`session_event.session_id` is `ON DELETE SET NULL`, chosen so an audit row
outlives the Session it describes (the schema says exactly that in a comment).
But `deny_mutation()` refused every `UPDATE OR DELETE` on `session_event` — and
the FK's SET NULL *is* an UPDATE. So the schema's own referential action was
rejected by the trigger guarding the same table:

    DELETE FROM session WHERE id = <a session that has any event>;
    ERROR: session_event is append-only; UPDATE is not permitted
    CONTEXT: SQL statement "UPDATE ONLY public.session_event SET session_id = NULL ..."

It survived because until Stage 5 **nothing in the codebase deleted a Session** —
there is no `DELETE /api/sessions/:id`, and `materializeGeneration()` removing
solver-rejected placements is the only such call. The first Stage 5 verification
passed only because it happened to have `deleted: 0`.

Fixed by `20260816180000_session_event_detach_on_session_delete`, which narrows
the trigger to permit **exactly one shape**: an UPDATE that sets `session_id`
and/or `counterpart_session_id` from a value to NULL with every other column
byte-identical. Repointing either column at a *different* Session, changing any
other column, a detach smuggled in alongside another column, a no-op UPDATE, and
DELETE are all still refused — pinned by 11 tests in
`tests/session-event-append-only.test.ts`. Event CONTENT stays immutable, which
is the property §3 actually needs; only the pointer to a row that no longer
exists may be cleared.

`ON DELETE CASCADE` was rejected (it destroys the audit trail the log exists
for) and so was `RESTRICT` (it contradicts the decision that unplaceable
Sessions are removed rather than left at placements the solver refused).

**2. `no_double_booking_group` flagged any two Groups under a shared root.**

`describeCollision()` intersected the EXPANDED conflict closure of *both* Sessions.
Every group expands to include its ancestors, so two groups sharing any common
ancestor always intersected at that ancestor — however unrelated they were:

    Seminar A1 → {Seminar A1, Class A, Informatics 2026}
    Class B    → {Class B,            Informatics 2026}
    ∩          = {Informatics 2026}   ← a false positive

Class B is neither an ancestor nor a descendant of Seminar A1 (0 rows in
`group_closure` either way) and no person is in both, so booking them
concurrently is legitimate. TAXONOMY.md §6 propagation is ancestors *and*
descendants — not "shares a root".

Fixed by expanding **one** side and intersecting against the other side's
DIRECTLY assigned groups by identity, mirroring the solver's own implementation.
Detection stays symmetric; only the reported ids differ, and reporting `b`'s own
Groups is what a human needs to see.

Scale of the bug, measured on the over-constrained Stage 5 schedule: the old code
would have flagged **390** sibling-only pairs on top of the 18 genuine ones. On
the ordinary 48-Session demo schedule it produced **24 phantom violations** where
the correct answer — and the solver's — is zero.

Three independent sources now agree on the same timetable: a closure query
computed directly in SQL (18 colliding pairs / 36 sessions), the app evaluator
(36 rows), and the solver (18 `GroupDoubleBooking` violations). Regression
pinned by `tests/violations-group-conflict.test.ts`, which fails 6 of its 8 cases
against the old logic.

### RESOLVED: a terminal run whose result was never captured

Found in Stage 6b verification. One run ended like this:

    status=SUCCEEDED  generation_id=NULL  termination_reason=NULL  has_result=f

A SUCCEEDED run is supposed to always produce a Generation (Stage 5). This one
produced none, because `result` was never captured — and `createGenerationForRun()`
correctly returns null when there is no result to propose.

**What happens is confirmed; the root cause is not.** It coincided with cancelling
a run that had *just* completed, so the `CancelRun` and the terminal
`GetStatus(include_result=true)` overlapped. The plausible mechanism is that the
cancel caused the solver to drop the finished run's result before the app asked
for it, but that has not been proven and should not be assumed.

**What IS proven is the recovery gap, which is the part that matters:**

- `pollSolverRun()` deliberately records the terminal status even when the result
  fetch throws (losing the transition would be worse — the run would look active
  against a solver that has finished it, and the one-active-run index would block
  that term).
- **Nothing ever retries.** The background poller claims only
  `PENDING/QUEUED/RUNNING`, and `GET /api/solver/runs/:id` short-circuits on
  `isTerminal(run.status)` before polling. So a terminal row with no result is
  never looked at again.

The run is therefore permanently unusable: no result, no Generation, no way to
get one, and the work the solver did is gone.

Stage 6b surfaces this honestly rather than making it worse — `deriveState()` maps
SUCCEEDED-without-a-Generation to the `failed` branch, so the UI says "The run
failed" instead of hanging on a spinner or offering a Review link to nothing, and
that case is unit-tested. But 6b does make the race *reachable from a button*,
since a user can now press Cancel at exactly the wrong moment.

**FIXED** by `20260817120000_solver_run_result_recovery` and `recoverRunResult()`.
Four things are worth keeping:

- **Discovery needed THREE gates widened, not one.** Besides the claim, the
  `SECURITY DEFINER` `tenants_with_due_solver_runs()` also filtered on active
  statuses — and the poller never visits a tenant that function does not name, so
  widening only the claim would have looked correct while doing nothing. Proven
  rather than assumed: with a recovery due, the widened function returns 1 tenant
  where the old active-only predicate returns 0. (`GET /runs/:id` was left
  short-circuiting on `isTerminal`, per Stage 4's on-demand-is-latency-only rule.)
- **The predicate names SUCCEEDED explicitly.** "Terminal and missing a result"
  would have chased 16 FAILED and 4 CANCELLED rows that correctly have none. Only
  SUCCEEDED promises a result.
- **`status` is never rewritten.** The run DID succeed and this row is the only
  record of it; the capture failure is a separate axis, so it gets
  `result_lost_at` and `result_recovery_attempts` rather than a new status value.
  "Result lost" is `status = 'SUCCEEDED' AND result_lost_at IS NOT NULL`. This is
  also what leaves the one-active-run index untouched — that index is partial on
  PENDING/QUEUED/RUNNING, so a SUCCEEDED run already frees its term either way.
- **NOT_FOUND short-circuits the budget.** `classifyPollFailure()` already knew
  the difference: a solver that has forgotten the run restarted, and the result is
  gone, so it is marked lost on attempt 1 rather than after five. Only
  `unreachable` consumes the 5-attempt budget (5s/15s/60s/300s backoff, written on
  the FIRST attempt — a terminal row has `next_poll_at = NULL`, which the claim
  reads as due, so without that the stuck rows would be re-claimed every tick).

Verified against a real corpus, not a fixture: the four genuinely stuck rows that
had accumulated in the dev database were all resolved to `result_lost` at exactly
attempt 5 with the specific message. A separately seeded run was recovered
end-to-end — result recaptured, `termination_reason` restored, Generation created
through the existing `createGenerationForRun()` — and a new run started normally
on a term holding four result-lost runs.

### Stage 6c: why the review screen shows two panels and no delta

The obvious design — "0 issues → 23 issues" — is wrong, and the screen
deliberately refuses to draw it.

`violations.current` comes from `constraint_violation`, which this app's
evaluator fills using **only the structural double-booking rules** —
`STRUCTURAL_CONSTRAINT_TYPES`, currently four. `violations.proposed` is the
solver reporting on **all 14 constraint types**. They are different measurements
of different things.

Measured, not assumed: on the same over-constrained timetable the solver reported
**23** hard violations, and after applying, `refreshViolations()` recorded **36
session-scoped rows plus 5 offering-scoped** — because the two evaluate different
rule sets. An arrow between those numbers would invent a comparison that does not
exist.

So the screen renders two labelled panels, each naming its own source ("checked
by Calendry — N structural rules" / "reported by the solver — 14 constraint
types") and an explicit line saying they are not a like-for-like difference.

**That N is derived from `STRUCTURAL_CONSTRAINT_TYPES.length`, not written out**,
and the reason is a bug this file's own drift rule predicted: the label said
"3 structural rules" for the whole of Stage 7 after `no_double_booking_person`
made it four. A user-facing count stating the wrong number, that nothing checks.
Do not replace it with a literal to save an import.

**A true delta needs a dry-run evaluator** — running the app's own evaluator over
the proposed placements without writing them, so both sides are measured the same
way. That is real future scope, deliberately not built: it is a genuine feature,
not a tweak, and faking it with the numbers available would be worse than saying
so.

### Rule: a page must not depend on permissions its own gate does not imply

**Not a tracked gap — the bug is fixed and this is the standing rule it left.**
Found in 6c verification. `/schedule/review/[id]` is gated on `session.read` (the
preview endpoint's permission), but its reference fetch called `/api/offerings`,
which requires `offering.read`. The `viewer` role has the former and not the
latter, so one 403 inside a `Promise.all` rejected the whole handler and rendered
a **completely blank page** — not an error, not a partial view, nothing.

Fixed twice over: offering names now travel with the preview response, under that
route's own gate; and the remaining reference fetches are individually tolerant,
degrading to showing ids rather than blanking the page.

The general rule, worth applying to any new page: **enumerate every endpoint a
page calls and confirm each is covered by the permission the page is gated on.**

**This rule was written down and then broken anyway, twice.** Prose is checked by
nobody, so it is now also a test: `tests/page-renders-per-role.test.ts` renders
each page as each seeded role and asserts the CONTENT came back, not merely a
200 — a blanked page returns 200 with a shell, which is exactly how both
incidents passed review. Adding a reference fetch that some role cannot reach
fails there immediately, whoever adds it.

A lint rule was considered and rejected: it could spot a `.catch`-less fetch
inside `Promise.all`, but it cannot know which permission an endpoint needs or
which the page is gated on, so it would fire on every correct reference wave and
be suppressed into uselessness. The symptom is trivially checkable even though
the cause is not.

**Adding a page means adding a row to that table**, with a marker that only
exists once the data resolved.

That suite found a third instance on its first run — `/schedule` had no page
gate at all while its wave needed five reads beyond `session.read` — and it is
now **fixed**: the page is gated on all six via `app/utils/schedulePermissions.ts`,
read by the route middleware AND by the nav entry, so the link is not offered to
someone the route will refuse.

**Gated rather than made tolerant, deliberately.** Degrading each fetch to an
empty list keeps the page up but renders "No time grid configured" — a LIE to
someone whose tenant has one and who merely may not read it, sending them to fix
the wrong thing. The denial instead NAMES the missing permissions, because the
whole reason this broke is that the page's real requirements were invisible.

`session_kind.read` is deliberately not among the six: kinds feed the Event
editor's picker, not the grid, so that one fetch stays individually tolerant.
A `Promise.all` of reference fetches turns one missing permission into a blank
screen, which is the least diagnosable failure a UI has. This bit again in the
schedule inspector's lecturer/group display (routes fetching `/api/roles` would
have blanked the schedule for the `viewer` role, which lacks `role.read`) —
caught before shipping by checking the live grant first.

### Tracked gap: solver violations naming Sessions the solver invented

A violation can name a Session the solver INVENTED, using a synthetic key that
appears in no placement, so there is no join key and the violation cannot be
attached to the row just created. `materializeGeneration()` counts these in
`violationsUnmapped` rather than dropping them silently. Full measurement and
the cross-repo fix shape are in **[BACKLOG.md](BACKLOG.md) § Solver**.
**Do not "fix" it here by guessing a mapping from offering + slot.**


### `bun run create:account` — adding an account to an EXISTING tenant

`provision:tenant` creates a tenant and its first admin. Nothing could add a
SECOND account to a tenant that already exists, which is why `vic@demo.local`
became a hand-inserted SQL artifact and why verification work kept borrowing —
and resetting — the real admin's credential twice over.

    bun run create:account -- --tenant test --email someone@example.edu \
        --name "Given Family" [--role tenant-admin] [--password …]

Owner connection, audited to stdout, same CLI-not-endpoint reasoning as
`provision:tenant` and `reset:password`. An email that already has an Account is
REUSED rather than duplicated — one credential acting in several tenants through
`account_person` is the point of a tenant-independent login — and its password is
left untouched.

`verify@calendry.local` in the `test` tenant is the dedicated HTTP-verification
account. Use it for route testing rather than a human's credential. **Its current
password lives in the gitignored `.env` as `VERIFY_ACCOUNT_PASSWORD`** — recorded
there rather than here because `.env` is not committed and this file is. Assume no
fixed value: it is rotated with `bun run reset:password -- --email
verify@calendry.local`, which prints a one-time password that must then be changed
through `POST /api/auth/change-password`. Update `.env` when you rotate it, or the
next session rediscovers the same dead end.

`vic@demo.local` and `viewer6b@calendry.local` are the two **under-privileged**
accounts, both holding the `viewer` role (six read permissions, deliberately
neither `solver.trigger` nor `generation.apply`). Use one of them whenever a
check is about an affordance being ABSENT — and remember the rule that goes with
it: assert the surrounding page rendered too, or the test passes for the wrong
reason. Their passwords are in `.env` as `VIC_ACCOUNT_PASSWORD` and
`VIEWER_ACCOUNT_PASSWORD`. Recreate the whole set on a rebuilt database with
`create:role` followed by two `create:account` calls.

### RESOLVED: constraint shape is now validated at the write boundary

Two gaps, one category — the rule builder honoured a rule the **generic CRUD
API did not**, so anything not going through the form wrote whatever it liked:

- **Severity contradicting the catalogue.** `no_double_booking_room` stored as
  SOFT with a weight was creatable through `POST /api/constraints`.
- **Negative weight.** Found later, and worse. `weight: -5` returned **201**.
  Every soft type declares "minimize", so a negative weight inverts a rule into
  a maximize it never declared — and because the solver derives
  `hard_penalty = sum(all soft weights) * placements + 1`, it also SUBTRACTS
  from the margin that keeps hard constraints outranking every soft
  configuration, for every rule in the tenant rather than just the mis-typed
  one. With enough negative weight the penalty goes negative and the search is
  rewarded for breaking hard rules.

Both now go through `validateConstraintShape()` in `shared/constraintTypes.ts`,
reusing the existing `severityMismatch()` so the write-boundary guard and
`assembleSolverInput`'s solve-time reporting cannot disagree. Four things worth
keeping:

- **It could not be one refinement, and the split is create-vs-update, not
  severity-vs-weight.** CREATE has `type` in the payload, so a zod
  `superRefine` sees everything. UPDATE has **no `type` at all** — verified: a
  PATCH carrying one returns 200 and leaves the stored type unchanged, because
  zod strips unknown keys. So the stored type is authoritative and must be
  READ, which a synchronous refinement cannot do. Hence `beforeUpdate`. Both
  rules live in one function called from both paths.
- **`beforeUpdate` validates ONLY the fields the patch touches**, and that is
  the whole design. Validating the merged row would make an existing bad row
  permanently uneditable — someone trying to DISABLE the row the guard objects
  to would be refused by the guard, exactly the trap the mislabelled constraint
  below already demonstrated once. Proven by falsification: switching to
  merged-row validation makes four tests fail (a legacy row can then no longer
  be disabled, renamed, or given a valid weight).
- **The floor is `>= 0`, not `>= 1`.** calendry-solver's own check is
  `weight < 0.0`, with "Zero is fine and means report the count, do not steer".
  The builder's `min: 1` was **stricter than the solver** and was relaxed to 0 —
  a control refusing a legal value is the same builder-versus-API divergence,
  pointing the other way. Still no ceiling: weight is relative and
  `hard_penalty` scales with the sum, so no magnitude lets a soft rule outrank a
  hard one. A per-field help note now says so explicitly, since a low weight
  being dominated by other configured rules looks identical to "the constraint
  is being ignored" — it isn't, it's just small relative to whatever else is
  enabled.
- **A database CHECK backs it up.** `constraint_weight_non_negative`
  (`weight IS NULL OR weight >= 0`) covers what the resource schema cannot:
  `provision-tenant.ts` writes baseline constraints with
  `tx.constraint.createMany` and never passes through `RESOURCES`. Refused even
  for the owner role over raw SQL. The severity rule cannot have a CHECK — the
  catalogue is code, not data — so it is refinement-only.

`report.severityMismatches` stays as a safety net for rows written before this.

**Still open, same family:** `params` accepts arbitrary JSON through the same
generic API — see BACKLOG.md § Undecided.

### The duplicate constraint: RESOLVED, and what it revealed

The `test` tenant had two enabled `minimize_exam_week_sessions` rows (weights 5
and 10). It was neither a deliberate duplicate nor kind-scoping: one of them was
named **"Cap online share per group"** — the catalogue label of a DIFFERENT type
— and the two were created eighteen seconds apart while exercising the Step 13
builder.

That mismatch was a real bug in `ManageConstraintBuilder.selectType()`, which
auto-filled the name only when it was blank. Choosing a type, then changing your
mind, updated the type and left the first type's label behind. Because `type` is
`createOnly`, the resulting row could never be corrected by editing — only
deleted and recreated. Fixed: the name now follows the type whenever it is still
an untouched auto-fill, and is never overwritten once someone types their own.
The mislabelled row was deleted through the API.

### `bun run create:role` — creating an AccessRole in an EXISTING tenant

Found while rebuilding the dev database after it was wiped: `provision:tenant`
mints exactly one role (`tenant-admin`, at creation) and `grant:permissions` only
widens a role that already exists, so nothing could create a new one and
`create:account --role viewer` failed outright. Permission-gated regression
checks — the 6b solver-control gate, the 6c viewer check — could not run at all.

    bun run create:role -- --tenant test --key viewer --name "Schedule Viewer" \
        --permissions session.read,group.read,room.read [--description …] \
        [--dry-run] [--yes]

**This is the one operator CLI whose writes do not need ownership**, and that was
verified against the live database rather than assumed. `access_role`,
`access_role_permission` and `person_access_role` are ordinary tenant-scoped
tables carrying `tenant_isolation` with both USING and WITH CHECK, so the app
role writes them happily once `calendry.tenant_id` is set — and is refused with a
foreign `tenant_id` in the payload, or with no context at all.

What the app role *cannot* do is resolve `--tenant <slug>` to an id: `tenant`'s
policy is `id = current_tenant_id() OR federation_id = current_federation_id()`,
so finding a tenant by slug requires already knowing which tenant you are. A
fifth `SECURITY DEFINER` lookup would fix that and was deliberately declined —
"an operator CLI would like a nicer argument" is not the comparably strong reason
the four existing exceptions each have.

So the owner connection resolves the slug, and the transaction then drops to
`SET LOCAL ROLE calendry_app` with tenant context before writing anything. That
narrows the write PATH, not the credential. What it buys is that a **mismatched
pair cannot be written**: `access_role.tenant_id` and
`access_role_permission.tenant_id` must both equal the context, so a bug
resolving the wrong tenant is refused by the database instead of quietly landing
a role in it. Pinned by `tests/access-role-writability.test.ts`, whose negative
cases are the point — a suite asserting only "the app role can write a role"
passes just as well against a build with `tenant_isolation` dropped entirely.

**There is deliberately no `--all`.** `provision:tenant` already mints a
full-catalogue `tenant-admin`, so a second one is an unaudited second superuser
role per tenant; more to the point, a role granted "everything" once silently
stops being everything the next time a permission is added — the same drift
`grant:permissions --all-missing` exists to repair. Compose it from two audited
steps instead.

Duplicates fail loudly and are never upserted (a second row that looks like the
first is worse than an error — see § "The duplicate constraint"), and a role
whose *display name* collides with an existing one warns without blocking, since
`name` is not unique but silence is how "Cap online share per group" came to
label a `minimize_exam_week_sessions` row.

Assignment stays with `create:account --role <key>`; granting a role to a person
who already exists is still Step 14.

### Step 14: AccessRole management has no UI and no API

Scope and current state in **[BACKLOG.md](BACKLOG.md) § Features not built**.
The durable part: `access_role`, `access_role_permission` and
`person_access_role` are deliberately absent from `RESOURCES`/`RELATIONS`, and
the editor this needs is a **picker over the fixed permission catalogue**, not a
generic form — AccessRole is tenant data, but the permissions it bundles are
code. Closer to the constraint rule builder than to the generic scaffold.


### Open items on auth (tracked, deliberately not built)

- **`must_change_password` — BUILT (operator reset), with gaps.** An operator
  can force a reset with `bun run reset:password -- --email …`, which revokes
  every session across every tenant, sets the flag, and prints an audit line;
  login then returns `requiresPasswordChange` and issues no session until
  `POST /api/auth/change-password` clears it. The remaining gaps — no rotation
  flag on the provisioned password, no expiry, no complexity rule beyond the
  12-character floor, no rate limiting, no email delivery — are listed in
  **[BACKLOG.md](BACKLOG.md) § Password policy gaps**.
- ~~**`WebUser` / `isAdmin` in `types/user.ts` is the template stub.**~~ **DONE.**
  `types/user.ts` and the store's `me` field are deleted rather than left as a
  second, wrong idea of who the user is; navigation gates on the real permission
  catalogue. Verified: `types/` holds only `index.ts` and `toast.ts`. The
  surviving mentions in `ViewMenu.vue`, `ViewLogin.vue`, `navigation.ts` and
  `store/index.ts` are comments recording the removal — do not read them as the
  stub still existing.
- **Federation-level permissions** are out of scope per TAXONOMY.md §9.4.
  Permissions are per-tenant only; administering federation-owned resources has
  no model yet.
- ~~**Session cleanup**~~ **DONE.** `server/plugins/sessionSweeper.ts` deletes
  `auth_session` rows whose `expires_at` passed more than 30 days ago — first
  sweep 60s after boot, then every 6h, opt out with `CALENDRY_SESSION_SWEEP=off`.
  `expires_at` alone is the whole predicate: such a row can never authenticate
  again, and the 12-hour TTL means a revoked row expires within half a day and is
  caught by the same test, so no `LEAST(expires_at, COALESCE(revoked_at, …))` is
  needed. The 30 days are not about the session — an expired one is already dead
  — but about `user_agent` and `ip_address`, which answer "where was this account
  used from" and are worth nothing if deleted the moment they matter.

  It deliberately has **none of the solver poller's claim machinery**: the work
  is one idempotent DELETE, so two instances racing means the loser deletes zero
  rows and both are correct. And it needs **no new RLS exception** — `auth_session`
  carries no RLS (exception 2 above) and `calendry_app` already holds DELETE, so
  it is an ordinary statement on the runtime connection from `authDb.ts`.

## The management area (Step 13)

`/manage` is one scaffold, not eleven pages. Three route files
(`[entity]/index`, `[entity]/new`, `[entity]/[id]`) render every entity from
`app/utils/manageRegistry.ts`, which is also the **navigation source** —
`useNavEntries()` projects the manage section straight out of it, so the
sidebar, the `/manage` index, the header and the Ctrl+K palette cannot drift
from each other or from the entity list.

- **Permission rule, uniform across every entity.** No `.read` → the section is
  *hidden entirely* (nav, index, palette; direct URL redirects to `/manage`).
  `.read` without `.create`/`.update`/`.delete` → *visible, read-only*, and
  read-only renders as **static text, not disabled inputs** — a disabled control
  reads as "unavailable right now" rather than "not yours". An unknown section
  is a 404, which keeps a typo distinguishable from a permission problem.
- **Bespoke means one slot, never a page.** `detailComponent` / `listComponent`
  replace the fields area or the rows; the shell, header, permission handling,
  save/error plumbing and delete confirmation stay shared. Qualifying cases:
  `GroupTree` + `GroupForm` (a hierarchy, and a parent picker whose options
  depend on the row being edited), `TimeGridEditor` (an ISO-weekday array plus a
  live preview built from the schedule's own `blockTime()`, and its own break
  editor — see "TimeGrid breaks" below), `ConstraintBuilder` (type, severity,
  weight and params constrain each other), and `CalendarPeriodEditor` (a
  bespoke week-reclassification preview — see "Academic calendar periods"
  below). **Offering is deliberately not one** — the hub of the model renders
  on the generic scaffold because its complexity is registry data (`fields`,
  `relations`), not different code.
- **`custom: true` on a field** keeps it in the draft, dirty tracking, payload
  and error mapping while a bespoke component supplies only its control. Leaving
  a field out of the registry instead drops it from the draft and silently from
  saves.
- **Relations are PUT-set sub-resources** (`server/utils/relations.ts`), edited
  as a whole collection and saved immediately, one request per change. They are
  not part of the form's Save button: the entity and each relation are separate
  endpoints with no shared transaction, so one button spanning them could
  half-succeed with a single error message covering both. A relation can
  optionally declare `warnAfterWrite` to return `{ rows, warnings }` instead of
  the bare array every other relation returns — see "Group↔Term scoping" below
  for the one relation that uses it, and why the response shape is conditional
  rather than changed for all of them.
- **The Ctrl+K palette holds no permission logic at all.** Its entire input is
  the already-filtered `useNavEntries()`, so there is no check to forget.
- **Overlays claim the keyboard through `useOverlay()`.** Page-level global
  Escape handlers (`useScheduleEditing`) stand down while a claim is held,
  which is what stops closing the palette from also cancelling a placement. The
  claim follows the open *state*, not the function that changed it — hanging it
  off `openPalette()` left the header's search button unclaimed.

## Academic calendar periods, and the exam-week dead end they closed

`calendar_period` had a table, a Prisma model, an RLS policy, a mapper and a
wire field since the initial schema — and **no way to write a row**, in any
tenant. It was absent from both `RESOURCES` and `manageRegistry`. Consequence:
no week was ever classified `EXAM` anywhere, so `minimize_exam_week_sessions`
reported zero violations while looking enabled and healthy, indistinguishable
from "working and satisfied." Raising its weight from 5 to 1000 (a workaround
tried before the real cause was found) multiplied zero by two hundred and
changed nothing — proven directly: a probe exam period inserted, then a solve
at weight 5 and at weight 1000, produced **byte-identical placements**. The
weight was never the problem.

**`calendar_period` is now a managed resource on the generic scaffold**, with
one bespoke field: a live week-reclassification preview. `kind` (a fixed
3-value enum), `name` and two dates are the whole row — none of what earned the
three bespoke editors their slot (a hierarchy, arithmetic no form field
expresses, fields that constrain each other) applies here. `Offering` is the
precedent for "complex entity, generic scaffold anyway."

**Permission: `term.update`, not a new one.** A calendar period is a child of
Term with a mandatory `term_id`, exactly like `time_grid_break` is a child of
TimeGrid — "changing when a term's exam period falls IS editing the term."
Adding `calendar_period.manage` would mean editing the catalogue and seed, a
backfill on every existing tenant, and authority over a table rather than a
capability (the shape CLAUDE.md already warns against for `offering_equipment.
update`).

**Validation: two rules enforced, one deliberately not.**

- A period fully outside the Term's date range → rejected (400). Such a row
  would classify no week at all — silently inert, exactly the failure this
  feature exists to end.
- A period partially overlapping the Term's end → allowed. Only the in-range
  part matters; clipping is the natural reading.
- **Overlapping periods within a Term → allowed, and not checked at all.** A
  holiday inside an exam period is completely ordinary, and the week-kind
  precedence rule (EXAM wins if any exam period touches the week, else
  whole-week BREAK, else whole-week HOLIDAY, else TEACHING) only has meaning
  *because* periods can overlap. Rejecting overlaps would contradict the
  resolver already shipped.

**Why the preview earns its place, not just its cost.** The mapping from two
dates to week kinds is genuinely unpredictable, and this is not hypothetical —
a real probe period (2027-09-27 → 2027-10-18) marked **four** weeks `EXAM`, not
three, because `EXAM` uses a "touches" rule (the week beginning 2027-10-18
counts on its Monday alone) while `BREAK`/`HOLIDAY` use "covers the entire
week" instead — so the *same dates* give a *different* answer depending on the
`kind` chosen. Nobody reading two dates predicts that. The preview renders each
week's new classification next to its old one.

**Week classification lives in `shared/academicCalendar.ts` as `classifyWeeks`,
and both the preview and the solver's own input call it** — the same
one-definition discipline as `shared/timeGrid.ts`'s block-boundary walk. A
locally-computed preview would eventually disagree with the wire and then state
the opposite of the truth while looking authoritative, which is the exact
failure class the `<select>`/`:selected` bug produced elsewhere.

**Verified end to end, closing the loop.** An exam period created *through the
API* for the first time returned the week kinds on the wire as
`…10:TEACHING 11:EXAM 12:EXAM`, and a solve at the ORIGINAL weight of 5 placed
**zero** sessions in weeks 11 and 12, redistributing all 65 into the earlier
weeks. Before this, the same term spread evenly across all 13 weeks including
those two. The constraint is reachable and effective, at the weight it always
had.

## Group↔Term scoping, and why the solver filter is reference-derived

Until this, `group` had **no relation to `term` at any level** — not on the
table, not through `membership` (which carries only `created_at`, no validity
window), not through `constraint_scope` (offering and kind only), and not on
the wire. The only link was transitive: `group → offering_group →
offering.term_id`. Two consequences, both measured:

- `assembleSolverInput` sent **every** tenant Group on every run, while
  Offerings and Sessions were already narrowed to the Term (10 sent, 2
  referenced on the demo tenant).
- The Offering editor's Group picker offered every Group regardless of the
  Offering's Term — nothing stopped attaching a 2024 cohort to a 2027
  Offering, and `RESOURCES.groups.filters` had no `termId` to narrow with even
  if it had wanted to.

The tenant was already encoding the Term into the Group's name
("dIT22 S1 4.Semester") for lack of anywhere else to put it — the requirement
asserting itself through a text field.

**Many-to-many (`group_term`), not `group.term_id` ownership.** The Group tree
carries two lifetimes: a leaf cohort belongs to one Term, but its parent
programme (e.g. "IT Security") persists across all of them and is never
directly scheduled. Ownership is unsolvable for the parent — either permit a
cross-Term parent (abandoning the model) or duplicate the programme node every
Term (destroying its identity and orphaning `membership` rows, which have no
Term of their own and need Group identity to stay stable for "which cohort is
this student in" to have an answer). M2M is also a strict superset of
ownership, and the reversibility argument settles it decisively: choosing M2M
and later finding everyone uses one Term is harmless; choosing ownership and
later finding cohorts persist is a migration that must merge duplicated
Groups.

**No link means visible in every Term — fail-open, deliberately**, which is
the opposite of this codebase's usual instinct and chosen anyway: scoping is
opt-in, so all existing Groups keep working the moment this ships and a new
Group is usable immediately rather than invisible until someone remembers a
second step. Fail-closed would make every existing Group unusable on landing
and make correctness depend on a perfect backfill.

Backfill is **derived from actual usage** — `offering_group ∪ session_group`
joined to their Term — not from a rule that guesses. Ancestors are deliberately
**not** auto-scoped: a programme node being an ancestor of something scheduled
in one Term doesn't make the programme itself Term-bound.

**The solver's Group filter is reference-derived, not scope-derived, and this
is the load-bearing decision, not a style choice.** Filtering the solver's
Groups by `group_term` would be the obvious move and is the wrong one: that
table is tenant *configuration* a human sets, and nothing forces it to agree
with what Offerings actually reference. Trust it and a mis-scoped Group
produces a `SolverInput` whose Offering names a `group_id` the solver was
never given — internally inconsistent, and the solver has no way to detect it.
Deriving from references cannot fail that way, because the references ARE the
source. The sent set is the **conflict closure** of the referenced ids (`{g} ∪
ancestors ∪ descendants`, since the solver rebuilds this itself from
`parent_id`), and it is closed under parent by construction — pinned three
ways: an assembly-time assertion, 600 randomised hierarchies checked against an
independently-written oracle, and a falsification test proving the guard isn't
a no-op. A sibling branch is deliberately not pulled in unless something
independently references it.

**The scope table is never allowed near solver input.** `group_term` exists
purely to answer "what should a human be offered in a picker," and that
boundary is the whole point of the design — see BACKLOG.md's "Constraint
params validation" entry and this file's drift-rule entries for the general
shape of what happens when a config table and the thing it configures are
allowed to silently disagree.

**Verified**: backfill scoped the two real cohorts and left the other eight
universal; the API narrows by `termId` correctly, including the two scoped
cohorts excluded from another Term; the picker narrows the same way, checked
against a server-rendered page (not just presence); the solver received
exactly the referenced Groups plus closure (3, not 2 — the closure correctly
pulls in the parent) with an independent SQL computation over `group_closure`
agreeing exactly; and an invariant assertion on real assembled input shows zero
dangling group references and zero orphaned `parentId`s in both directions,
for both a populated and an empty Term.

### Warning when a Group is scoped out of a Term that still uses it

Real, harmless, and until this addition, silent: scoping a Group out of a Term
whose Offerings or Sessions still reference it doesn't break anything (the
solver's filter is reference-derived, see above — existing links keep
working), but the Group then stops appearing in that Term's pickers, so a
removed link can't be re-added without first re-scoping.

**There is no "save" to warn before.** `ManageRelationsPanel` has no Save
button — `add()`/`remove()` each call `persist()` directly, so removing a Term
from the list IS the save. The warning therefore lands **after the write**,
computed server-side inside the same transaction, and reported alongside the
control — the same shape as hard-constraint violations from manual edits
(warn, don't block, state the consequence next to where it happened).

The response shape is **conditional**: a relation declaring `warnAfterWrite`
returns `{ rows, warnings }`; every other relation still returns the bare array
it always did, verified by a test that fails if the shape becomes unconditional
for all of them (an object where an array is expected makes `Array.isArray`
false client-side, so the regression would be a picker silently rendering an
empty set — not an error).

Rendered as `picker_warning`, in the warning palette with `role="status"`,
deliberately not the error tone (`alert`) — a user who just saved successfully
must not be shown red. Clearing every Term (widening a Group back to universal)
produces no warning, since nothing can be orphaned by becoming universal;
that's asserted explicitly rather than left to fall out of the query by
accident.

## Bootstrap & deploy sequence

The order matters, and each step depends on the one before it.

```
1. migrate deploy    schema only — tables, RLS, triggers, indexes. No rows.
2. db seed           reference data (the 46-row permission catalogue).
3. provision:tenant  the first tenant, its admin, and baseline constraints.
4. start the app
```

- **Local:** `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db`,
  then `bun run db-seed`, then `bun run provision:tenant -- --slug … --name … --admin-email … --admin-name …`.
  Migrations are applied by the dev entrypoint, or run `prisma migrate deploy`
  yourself.
- **CI/CD and containers:** both `.config/entrypoint.sh` and
  `.config/entrypoint.dev.sh` run `migrate deploy` then `db seed` before
  starting the app. `migrate deploy` does **not** auto-seed — only
  `migrate reset` and `migrate dev` do — so the explicit step is required in
  production and must not be removed.
- **Rebuilding a dev database:** `bun run db-reset` (`prisma migrate reset`)
  replays the migrations *and* runs the seed automatically.
- **Adding a CONSTRAINT TYPE needs a backfill too, for the same reason.**
  `provision:tenant` creates one default row per live catalogue type at creation
  time only, so a type added later leaves every EXISTING tenant without a row —
  and a missing row is a rule that never runs (see Conventions). Repair with
  `bun run backfill:constraints -- --all-missing` (`--dry-run` first; owner
  connection, audited to stdout).

  It only ever CREATES absent rows and never edits an existing one, so a
  tenant's toggles, weights and params survive a re-run untouched. Deliberately
  not part of `db seed`: the seed runs on every deploy and carries reference
  data that is code, whereas constraint rows are tenant data — a seed writing
  them per deploy is the same mistake as one silently widening AccessRoles.

- **Adding a permission needs a fourth step.** `db seed` mirrors the catalogue
  into the `permission` table, but it deliberately does not touch
  `access_role_permission` — which permissions a tenant's roles *hold* is tenant
  configuration, and a seed that silently widened every tenant's admin role on
  each deploy would be privilege escalation with no audit trail. `provision:tenant`
  grants the full catalogue only at creation time, so **existing** tenants are
  left without the new permission and the symptom is a 403 on a feature that
  visibly exists. Backfill with
  `bun run grant:permissions -- --role tenant-admin --all-missing`
  (`--dry-run` first; owner connection, audited to stdout like `reset:password`).
- **A rebuilt dev database has one role and one account.** To restore the
  under-privileged accounts the permission-gated checks need:
  `bun run create:role -- --tenant test --key viewer --name "Schedule Viewer"
  --permissions session.read,group.read,room.read,person.read,term.read,time_grid.read`,
  then `create:account` twice against `--role viewer`.

### The helper schema is `calendry_internal`, never `calendry`

Helper functions (`current_tenant_id()`, the closure triggers, the two
`SECURITY DEFINER` bridges) live in a schema called **`calendry_internal`**. The
name matters: the database owner role is `calendry`, and PostgreSQL's default
`search_path` is `("$user", public)`. A schema named `calendry` would therefore
capture every unqualified `CREATE` issued by that role — including Prisma's own
`_prisma_migrations` table, which the engine creates *before* any migration SQL
runs, so no amount of `SET search_path` inside the files can prevent it.

This is not hypothetical: it silently put all 35 tables in the wrong schema and
broke `prisma migrate reset`, because reset drops only `public` and leaves the
helper schema behind, which flips the resolution order on the second run.

Both migrations also begin with `SET search_path = public;` as a second line of
defence. Note the **GUC names stay `calendry.tenant_id` / `calendry.federation_id`** —
session settings are a different namespace from schemas and were not renamed.

### The solver runs as a compose service, and has two addresses

`docker compose up` now brings up app, database AND solver. The solver is a
vendored git submodule at `vendor/calendry-solver`, built by
`.config/Dockerfile.solver` — the Dockerfile lives HERE rather than in the solver
repo so the whole stack is described in one place, and nobody needs a second
checkout to get a working environment.

**It has its own nested submodule.** `calendry-proto` sits at
`vendor/calendry-solver/vendor/calendry-proto`, so a plain `git submodule update
--init` is not enough — it needs `--recursive`, or the Rust build fails in
`build.rs` with a (very clear) message about the proto directory being absent.

**`CALENDRY_SOLVER_ADDR` means two different things**, which is the trap to know:

- on the **solver** it is where to BIND. Its own default is `127.0.0.1:50051`,
  which inside a container is reachable by nothing, so the compose service sets
  `0.0.0.0:50051`.
- on the **app** it is where to CONNECT.

That is why a host-run solver was unreachable from the app container twice: the
address was right for a host-run app and meaningless from inside a container, and
the solver was bound to loopback so even the bridge gateway was refused.

**Two addresses, same pattern as the two database URLs.** `solver:50051` resolves
only on the compose network; `bun run test` starts a Nuxt server on the HOST,
where it does not. So `solverAddress()` picks by testing for `/.dockerenv`,
exactly as `scripts/lib/ownerDatabaseUrl.ts` does — `CALENDRY_SOLVER_ADDR` inside,
`CALENDRY_SOLVER_ADDR_HOST` outside. Port 50051 is published in the dev override
for the same reason 55432 is: host-side tooling. Production publishes neither.

**`docker compose up -d <service>` does not start what it does not name.** Bringing
up only `solver` and `calendry-app` left the database stopped and every test
failed with "Can't reach database server at 127.0.0.1:55432", which looks like a
configuration bug and is not one. Use a bare `docker compose up -d`.

### Two database URLs, one database

`MIGRATION_DATABASE_URL` uses `db:5432`, which resolves only between compose
containers. `MIGRATION_DATABASE_URL_HOST` uses the port `docker-compose.dev.yml`
publishes, for anything run from a developer's shell. Both are present inside
the container (bun auto-loads `.env`, and the app container mounts the repo), so
tooling cannot simply prefer whichever is set — `scripts/lib/ownerDatabaseUrl.ts`
picks by testing for `/.dockerenv`. `prisma.config.js` repeats that logic, since
it is loaded before any TypeScript is available.

All three owner-connection consumers — the Prisma CLI, the seed, and
`provision:tenant` — go through that selection. The runtime app role never does:
it cannot write the catalogue (SELECT-only RLS policy) and cannot create tenants.

## TimeGrid breaks: non-uniform, and one thing left open

`time_grid.break_minutes` is the DEFAULT gap between consecutive blocks.
`time_grid_break` adds sparse named overrides — `{afterBlockIndex, durationMinutes,
label, dayOfWeek}` — where `dayOfWeek NULL` means every active day and a
day-specific row beats it **at that position only**, so "same lunch every day,
but Friday's afternoon break differs" is one extra row, not a duplicated day.

**`shared/timeGrid.ts` is the single definition of when a block starts — and
that now includes RENDERING.** `ScheduleGrid.vue` was built before breaks
existed and kept a uniform stride (`grid-auto-rows` + one CSS row per block)
long after the feature landed, so a tenant with a 45-minute morning break saw
their blocks butted together while the time column correctly read 12:15 then
13:00. Times right, picture contradicting them.

It is now laid out in MINUTES from `blockBoundaries()`, per day. **One CSS grid
could not be fixed by adding break rows**: row heights are shared across
columns, and a day-specific break means two days genuinely have different block
start times. So each day is its own positioned stack sized from
`blockBoundaries(grid, day)`, the time gutter shows the universal timeline as a
reference, and a day that differs drifts from it visibly and is labelled "own
breaks". Verified on the demo tenant: Mon–Thu and Sat at 193.85px with a 45-min
break, Friday at 216.92px with a 120-min one.

`breakAfter()` and `gapsOfDay()` were added for the same reason the walk was:
the editor's preview had grown its OWN break lookup
(`breaks.find(b => b.afterBlockIndex === i && (b.dayOfWeek === day || b.dayOfWeek === null))`),
which returns whichever row is first in the array — so with a universal and a
day-specific break at one position it could NAME one break while `blockTime()`
had already applied the other's DURATION. A fourth divergent stride in embryo,
in the one component whose purpose is showing the two agree. Both
`blockTime()` (what a block is called) and `blockOfMinute()` (which block it is
now) walk cumulative boundaries through it. They answer inverse questions about
one timeline, and if they disagreed the schedule would render one time while
`reference_slot` believed another — invisibly, until the solver refused to move a
Session a user could see was still ahead. Do not reintroduce a local
`blockLength + breakMinutes` stride anywhere; three had accumulated before this
landed (the editor's preview, the diagnostic script, and the two helpers).

**This is not only rendering.** `blockOfMinute()` feeds `computeReferenceSlot()`,
which decides what the solver may move, and that function now passes the resolved
DAY so a day-specific break is honoured. Computing it against the universal
schedule would let a Friday afternoon class be rescheduled after it had run.

**Nothing about breaks reaches the solver, and that is verified, not assumed.**
The wire carries block INDICES; a gap's duration changes no index, no adjacency
and no conflict. `toWireTimeGrid()` omits break data and has a test asserting the
omission. Confirmed against the full feature: a run with two overrides configured
returned SUCCEEDED and no break data appears anywhere in the request. Zero
changes to `calendry-proto` or `calendry-solver`.

**`fitsGrid()` deliberately does not consider breaks.** Its criterion is whether
a field participates in the INDEX SPACE, which is exactly `blocksPerDay ×
activeDays`. A break names an `afterBlockIndex` — it references that space
without defining it — so adding a lunch creates, destroys and renumbers nothing.
This same `fitsGrid()` guard also refuses narrowing `blocksPerDay`/`activeDays`
out from under an existing Session (the actual TimeGrid-shrink incident) and the
same predicate gates the move route, so a Session cannot be moved off-grid
either.

**Orphaned breaks are deleted and reported; orphaned Sessions refuse the edit.**
The asymmetry is the design. A Session outside the grid is DATA that resolves to
no time and breaks the solver. A break after a block that no longer exists is
CONFIGURATION whose meaning has already gone — refusing a legitimate shrink to
protect it would be worse. Both run in the same transaction, so a refused shrink
deletes nothing, which is pinned by a test.

### OPEN QUESTION — a Session whose duration spans a break

**Undecided, deliberately** — see **[BACKLOG.md](BACKLOG.md) § Undecided**. It
matters here because one of the two branches would overturn the decision this
whole feature rests on: if such a placement is illegal, the SOLVER would need to
know about breaks, and breaks currently never cross the wire.

## `MinimizeBlockUsage` — generalizing first/last block into a block list

`MinimizeFirstBlock`/`MinimizeLastBlock` were the same hardcoding as
"minimize Saturday" one axis over — `is_first_block`/`is_last_block` are
booleans baked into `SlotFlags` at fixed positions, and extending a TimeGrid's
day silently moves what "last block" means underneath a tenant who never
touched the rule. Replaced with `MinimizeBlockUsage { blocks: number[], first:
bool, last: bool }` — absolute indices for "avoid block 5 specifically," plus
the two relative booleans so "avoid the last block, however long the day gets"
stays expressible without re-editing every time the grid changes. A strict
superset; nothing is lost.

Published as `calendry-proto@0.4.0`. **This entry said 0.3.0 until 2026-08-24;
that was wrong, and the way it was wrong is worth keeping.** `v0.2.0`, `v0.3.0`,
`v0.3.1` and `v0.3.2` are four tags on ONE commit (`7856748`) with byte-identical
proto trees — publish retries that shipped no schema change. The commit that
actually adds `MinimizeBlockUsage` (`506dacd`) is tagged `v0.4.0` alone, which is
why `package.json` depends on `^0.4.0` while the submodule's newest commit is
still MinimizeBlockUsage. Nothing was published "between" the two numbers; the
version in this file was simply never corrected after the retries. Read a tag,
not a memory: `git -C vendor/calendry-solver/vendor/calendry-proto log -1 <tag>`.

Fields 20/21 (the old types) are kept and
marked `deprecated`, not removed — `buf breaking` rejects removal outright, and
a peer on the old schema may still send them. The app's catalogue keeps both
old types too, marked `deprecatedBy`, since `type` is `createOnly` and removing
them would make existing tenant rows unrenderable and uneditable.

Verified with a real live solve after publish: `minimize_block_usage` correctly
avoided the configured blocks; the change was proven against a real encode of
the new proto message, not just a passing unit test against a plain object cast.

## Resolved, with the reasoning kept

**Open bugs and deferred work live in [BACKLOG.md](BACKLOG.md).** What follows
is the opposite: problems that ARE fixed, kept here because each one's fix
encodes a decision that would otherwise look arbitrary — and that someone could
reasonably "fix" back to something worse. Deleting these would delete the
argument, not the bug.

- **~~Applying a Generation rebased `generation_id` on every unlocked Session in
  the TENANT.~~ FIXED 2026-08-23.** `apply.post.ts` ran
  `updateMany({ where: { tenantId, isLocked: false } })` with no term filter, so
  applying a run for one term re-attributed every *other* term's Sessions to a
  Generation that never placed them.

  It survived because the damage is invisible: the schedule renders identically
  either way, no constraint is affected, and `generation_id` is only read when
  someone asks where a placement came from — which nothing in the UI does yet.
  A provenance bug in a system whose whole audit story is provenance.

  Now scoped to the applied term, and additionally excludes Events
  (`offeringId: { not: null }`): a human placed an Event, so "which run produced
  this" has the answer NONE, and overwriting that would make it
  indistinguishable from solver output. Do not widen either filter back —
  `updateMany` with fewer conditions looks like a simplification and is a
  correctness regression that no test outside `generation_id` assertions would
  catch.

- ~~**Three hand-written indexes are MISSING from the database.**~~ **RESOLVED
  BY MEASUREMENT — no migration, and deliberately so.** The accidental migration
  `20260813190131_init` (generated by `db-reset` before it was fixed) dropped
  three indexes and is applied. They were measured before being recreated, and
  the evidence said not to:

  ```
  session_room_conflict_idx     ON session_room   (room_id, session_id)
  session_person_conflict_idx   ON session_person (person_id, session_id)
  session_event_replay_idx      ON session_event  (tenant_id, generation_id, created_at, seq)
  ```

  **The first two were tracked against a query shape that does not exist.** The
  original comment — and this file until now — said they back "the room/person
  collision lookups in `refreshViolations()`". They do not. Every site that
  touches these tables drives off `session_id`, never `room_id`/`person_id`:
  `violations.ts` (`sessionId: { in: involvedIds }`), `solverInput.ts`
  (`include: { rooms, people }`), `move.post.ts`, `generationMaterialize.ts`,
  `affected-persons.get.ts`. Stage 7a's `no_double_booking_person` is no
  exception — it builds attendee sets from session-keyed reads plus
  `membership`. All of them are already served as **index-only scans** by
  `session_room_pkey (session_id, room_id)` and
  `session_person_pkey (session_id, person_id)`, and any future point lookup by
  room or person is covered by the existing single-column
  `session_room_room_id_idx` / `session_person_person_id_idx`. So these are not
  premature — they are the wrong shape, and adding them costs write
  amplification on tables every editing route writes.

  Measured on a probe schema at solver scale (27k sessions, 27k `session_room`,
  54k `session_person`), not on the 65-row dev tenant:

  ```
  A  session_room   WHERE session_id IN (40)  before 0.336ms → after 0.225ms  same plan
  B  session_person WHERE session_id IN (40)  before 0.307ms → after 0.176ms  same plan
                    idx_scan = 0 on BOTH new indexes — never chosen
  C  federation_room_occupancy() join         before 5.802ms →       5.720ms  identical
     forced onto session_room_conflict_idx           5.713ms / 8252 buffers vs 514
  ```

  C is the only room-driven query in the system, and it is a bulk join over ~10%
  of the table with no `room_id` equality predicate — the seq scan is correct
  and the index cannot beat it, only cost 16× the I/O.

  **`session_event_replay_idx` has the right shape for a query nobody runs.**
  `session_event` is write-only today: `sessionEvents.ts` creates rows, the demo
  seeder deletes them raw, and there is **no read path anywhere** in `server/`,
  `app/` or `scripts/` — no rollback or audit-history route is built. At 205k
  events the natural plan uses the existing `session_event_generation_id_idx`
  (0.653ms); with the tracked index it is 0.660ms, because a bitmap scan
  discards ordering and it still sorts. Forcing an ordered `Index Scan` on a
  5,000-event generation does remove the sort (1.643ms → 0.862ms), so the shape
  is right — but that is 0.8ms on a query that does not exist, for an 11 MB
  index.

  **Add it in the same change as the replay reader**, where the ordered scan can
  be verified against the real query instead of guessed at. Note that until
  2026-08-23 adding it would not have stuck: `db-reset` ran `migrate dev`, which
  is what dropped these three in the first place — see the "Never regenerate
  `prisma/migrations/`" rule. That half is now fixed, so a future hand-written
  index survives a rebuild. Same reasoning the
  session sweeper applied at 28 rows, with the addition that the other two would
  still be unused at 27,000. Do not recreate any of the three "to close the
  tracked item" — the item is closed.


Deliberately deferred, with the reasoning, so these are not rediscovered as
surprises. None of these block current work.

- ~~**Raw-SQL account artifacts in the `test` tenant.**~~ **BOTH RESOLVED.** Each
  was originally written directly to the database, bypassing the paths that would
  normally create them; each now exists only through an operator CLI. Kept here
  because the reasoning is the record of why those CLIs exist at all:

  - ~~**`ntill@gmx.de`'s password was set by hand.**~~ **RESOLVED.** Replaced
    through the real path by `bun run reset:password`, which hashes via
    `hashPassword()` from `server/utils/auth.ts`, revokes every session, sets
    `must_change_password`, and emits an audit line. The password was then
    changed through `POST /api/auth/change-password`. No hand-written hash
    remains for this account. (The duplicate scrypt implementation that made
    this a risk is also gone: `provision-tenant.ts` now imports the same
    `hashPassword()` rather than carrying its own copy.)
  - ~~**`vic@demo.local`** is a hand-inserted Person + Account + `viewer`
    AccessRole.~~ **RESOLVED.** Both it and `viewer6b@calendry.local` are now
    created through `bun run create:role` + `bun run create:account`, with no raw
    SQL anywhere in the path. Their passwords live in the gitignored `.env` as
    `VIC_ACCOUNT_PASSWORD` / `VIEWER_ACCOUNT_PASSWORD`.

    **The role holds SIX permissions, not the seven previously recorded here.**
    The original raw SQL listed seven, but vic's live `GET /api/auth/session`
    reported six, and `session.get.ts` applies no filtering — it returns
    `loadPermissions()` verbatim — so one INSERT never landed. The measurement
    overrides the written record. The set is:

        group.read, person.read, room.read, session.read, term.read, time_grid.read

    `violation.read` was intended and absent. Recreated as six deliberately,
    because six is what the 6b/6c evidence was actually gathered against.

- **~~`CommonButton` renders a `<div>`~~ — FIXED.** It rendered a `<div>` with a
  click handler, so every action built on it — the whole schedule inspector, the
  solver control, the palette — was mouse-only: no Tab, no Enter/Space, not
  announced as a button. `getTag` now defaults to `'button'` (including the
  disabled case, so assistive tech hears "unavailable" rather than nothing).

  Two things that made this less trivial than it looks, worth not rediscovering:

  - **`type` was already taken** by the visual variant (`primary`,
    `secondary-black`…), so the native button type needed its own prop:
    `nativeType`, defaulting to `'button'`. Without that default, changing the
    tag would have turned every button inside a `<form>` into an accidental
    submit.
  - **`login.vue` and `change-password.vue` depended on native submit.** They
    passed `tag="button"` with NO `@click`, relying on the form's
    `@submit.prevent` so Enter works in either field. They now pass
    `native-type="submit"` — verified by pressing Enter in the password field and
    landing on `/`.

  A native `<button>` also inherits the UA font rather than the page's, so
  `font: inherit` was added to `.button`; computed font now matches `body` on
  every page.

- ~~**Pre-launch sweep for leftover template-author branding/strings.**~~ **DONE.**
  The Step 1 rebrand searched only for the `xxx-changeme` placeholder pattern, so
  anything the template author hardcoded under a different name survived it;
  `Swindler` (the page title and header text) was found by accident while
  building the login UI and fixed then. A full case-insensitive sweep across all
  three repos has now been done and found exactly **one** further instance:
  `bun.lock` still recorded `"name": "xxx-changeme"` for the workspace, because
  the rebrand changed `package.json` and `bun install` does not rewrite that
  field (it reports "no changes" even when the two disagree). Fixed by hand and
  re-verified with `--frozen-lockfile`.

  Everything else was clean: `package.json` metadata, README, `robots.txt`, the
  `useHead` titles, layouts, devcontainer, both compose files, `.config/`, and
  both sibling repos. Note the stakes were lower than this entry assumed — the
  template's author is this repo's own author, so there was never another
  institution's product name to leak.

  **Two vatsim-radar attributions in `modules/styles.ts` and
  `app/scss/variables.scss` are deliberately KEPT.** They are provenance for
  borrowed code (`// From https://vatsim-radar.com/ … modified to fit our
  needs`), not branding; removing them would strip credit from third-party-derived
  work. Do not "finish the sweep" by deleting them.

## Things to never do without asking first

- Add/rename/restructure a fixed taxonomy entity
- Hardcode a tenant-open value (role name, kind, equipment tag) into logic
- Bypass the event log for a Session mutation
- Implement solver logic in this repo
- Relax tenant isolation for anything other than declared Federation-shared
  resources