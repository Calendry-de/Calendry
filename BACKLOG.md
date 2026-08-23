# BACKLOG.md — Calendry

The **transient** half of this project's persistent memory. CLAUDE.md holds what
must not be undone — architecture, RLS boundaries, conventions, and the reasoning
behind decisions someone might otherwise reverse. This file holds what someone
might still *do*: open bugs, deferred work, undecided questions, and the phase
checklist.

**Every entry here is verified-on-use, not trusted.** That rule is not decoration.
The three "missing" database indexes were tracked as backing a
`refreshViolations()` query shape that has never existed; they were closed by
measurement rather than by migration, and recreating them on the strength of the
written description would have added two indexes the planner never chooses. So:
when an entry here is your reason for changing something, confirm its claim
against the code first, and measure if the claim is about performance. Then
correct the entry with what you found, whichever way it went.

This file carries **more** drift risk than CLAUDE.md, not less — nothing else in
the repo references it, so nothing contradicts it when it goes stale. See
CLAUDE.md § Conventions, "A tracked-gap entry written from design INTENT can
drift from the code silently".

Last full verification pass: **2026-08-23**. Design-pass items below merged in
from planning conversation on the same date — none of these have a build session
yet.

---

## Current phase

- [x] Repo rebranded from template (`xxx-changeme` → `calendry`)
- [x] TAXONOMY.md alignment confirmed
- [x] Database schema (migrations) for core entities + join tables
- [x] CRUD + editing API routes
- [x] Solver interface boundary (stub, not implementation)
- [x] Tenant provisioning CLI (`bun run provision:tenant`)
- [x] Authentication (global Account, post-login tenant selection)
- [x] Per-tenant permissions (AccessRole + fixed permission catalogue)
- [x] Login/profile UI wired to the auth API
- [x] Schedule view + editor UI
- [x] Management UI for the core entities + Ctrl+K command palette
- [x] Academic calendar periods (holidays/breaks/exam periods) — managed
      resource with a live week-reclassification preview; closed a
      long-standing dead end where `minimize_exam_week_sessions` could never
      fire because no tenant could ever write a `calendar_period` row
- [x] Group↔Term scoping — many-to-many, fail-open (unscoped = universal),
      with a reference-derived solver filter and a save-time warning when
      scoping a Group out of a Term that still uses it
- [ ] AccessRole / permission management UI (Step 14) — the operator CLI
      `create:role` exists; the tenant-facing UI and its API do not
- [x] **Solver integration Stages 1–7 — COMPLETE.** Start a solve, never lose
      the result, review it, apply or discard it; person-level clash detection,
      Federation-shared Rooms with real cross-tenant occupancy, and
      federation-shareable Sessions. Both remaining cross-repo items are now
      closed too: the solver's virtual-room capacity-1 bug is fixed in
      `calendry-solver`, and the AccessRole gap that blocked viewer-account
      regression checks is closed — see `create:role`.
- [ ] Import (CSV/Excel)
- [ ] Export (iCal/Google/Outlook)
- [ ] Notifications (delivery; audience resolution already exists)

Update the checklist above as phases complete — don't let this file go stale.

---

# Solver

## Staged plan

| Stage | Scope |
|---|---|
| ~~1~~ | **DONE.** Package wiring (`bunfig.toml` auth), `@mindcollaps/calendry-proto@0.2.0` + `@grpc/grpc-js` installed, real StartRun→GetStatus round trip proven against a live solver. The `scripts/solver-smoke.ts` probe was deleted on 2026-08-23, its retirement condition (Stage 2's real client) having been met long before. |
| ~~2~~ | **DONE.** `solver_run` table + `solver_run_one_active_per_term` partial unique index; `/api/solver/runs` (POST/GET/`:id`/`:id/cancel`) replacing the deleted `/api/solver/generations` stub. Input is still the placeholder. |
| ~~3~~ | **DONE.** Real `SolverInput` assembly from Prisma: calendar, slot arithmetic, entities, wire-up, placeholder deleted, `RUNNING → CANCELLED` verified. 3d closed too — `toWireConstraint` maps all **four** parameterised types (`max_online_ratio_per_group`, `minimize_block_usage`, `minimize_specifc_day`, `minimize_high_ranking_rooms`; the other eleven declare `params: []`), and `ManageWeekdayPicker.vue` was extracted. |
| ~~4~~ | **DONE.** Background poller (`server/plugins/solverPoller.ts`) owns advancing runs and capturing results; on-demand `GET /runs/:id` is latency only. Adaptive cadence, `FOR UPDATE SKIP LOCKED` claim, NOT_FOUND→FAILED. |
| ~~5~~ | **DONE.** `generationFromRun.ts` (poller creates a READY Generation on SUCCEEDED) + `generationMaterialize.ts` (create/move/unchanged/delete partition, violations onto `constraint_violation`). Verified both ways: a clean run applied end to end, and an over-constrained SUCCEEDED-with-23-violations run applied successfully. Fixed two pre-existing bugs it uncovered — see CLAUDE.md § "Stage 5: two pre-existing bugs it uncovered". |
| ~~6~~ | **DONE.** 6a: plan/execute split + `GET /api/generations`, `/:id`, `/:id/preview`, `POST /:id/discard`, `termination_reason` capture. 6b: six-state solver control in the schedule toolbar, honest progress, cancel, run adoption. 6c: `/schedule/review/[id]` — two non-commensurable violation panels, change partition, diff grid, apply/discard. |
| ~~7~~ | **DONE.** 7a: `no_double_booking_person` in the manual-edit evaluator — both sides expanded to people, intersected by identity. 7b: `federation_room_occupancy()`, a parameterless SECURITY DEFINER function, feeding `externalOccupancy` and unlocking federation-owned Rooms in `SolverInput`. 7c: `session` federation-shareable — shared row, tenant-private participant links, `session_room` widened. |

## Needs a decision, not a design pass

- **[calendry-solver]** MaxOnlineShare enforcement gap. The virtual-room
  capacity-1 bug was accidentally enforcing the share cap; now that it's
  fixed, the cap is genuinely violated at scale (180 → 455 share violations
  at large-university in one measured run). Three candidate directions
  recorded with real measurements in `calendry-solver`'s own CLAUDE.md: raise
  the app's move budget, fix `ruin_worst` to score total objective (it
  currently only scores soft, missing 99.98% of the objective at scale
  post-fix), and/or a generator realism fix. Not this app's repo to fix, but
  worth tracking here since it affects what a SUCCEEDED run's violations look
  like for any tenant with meaningful online delivery.
- **[calendry]** "Multiple candidate schedules" — running the solver to
  produce several genuinely different options to choose between, rather than
  one best result per run. Discussed as an idea during a planning
  conversation, never scoped. Needs its own design pass (naming, ensuring
  candidates are actually different rather than near-duplicates, a schema
  change to carry >1 result per run) if it's wanted at all.

## Tracked gap: equipment QUANTITY cannot cross the wire

`RoomEquipment.quantity` and `OfferingEquipment.quantity` both exist — "this lab
has 24 workstations", "this offering needs 24". The proto carries
`Room.feature_tags` and `Offering.required_room_features` as plain string lists,
so both become presence-only: "has `workstation`", "needs `workstation`".

The solver therefore cannot reason about counts, and a 12-seat lab satisfies a
24-workstation requirement. `assembleSolverInput` counts the dropped quantities
and returns them in its report rather than narrowing quietly. Same shape of fix
as the multi-room gap below: either the proto grows a quantity, or the app
accepts presence-only semantics deliberately.

## Tracked gap: a Session with more than one Room cannot cross the wire

`session_room` is a join table, so the app models a Session in several Rooms at
once. The proto's `Session` and `PlacedSession` both carry a single `room_id`.
A multi-room Session therefore cannot be fully represented in either direction:
the input mapper sends the first room and reports the rest, and Stage 5 will
face the same narrowing coming back.

Not urgent — the demo tenant has none, and `multiRoomSessionIds()` in
`solverSessions.ts` reports any that appear rather than silently dropping them.
But it is a real expressiveness limit, not an implementation shortcut: closing
it means either a proto change (repeated `room_id`) or a decision that Calendry
Sessions occupy exactly one Room. Do not "fix" it by quietly picking a room.

## Tracked gap: solver violations naming Sessions the solver invented

`SolverOutput.hard_violations` identifies Sessions by id, but for a Session the
solver INVENTED the two id spaces in the same response do not agree:

- `PlacedSession.session_id` is **empty** (953 of 993 placements in the Stage 5
  over-constrained run).
- the violation names it with a synthetic `"<offeringId>#<index>"` key
  (`…-offering-6#19`), which appears **nowhere** in the placements.

So there is no join key. The app cannot attach such a violation to the Session
row it just created, because nothing links the synthetic id to the placement that
produced it. Measured: of 36 session references across 18 `GroupDoubleBooking`
violations, **7 resolved and 29 did not** — exactly the 29 that named invented
Sessions.

`materializeGeneration()` counts these in `violationsUnmapped` rather than
dropping them silently, which is the right behaviour but not a fix. Closing it is
a cross-repo change and belongs with the solver, which needs to give a
newly-created `PlacedSession` a **stable, joinable reference** in violation
reports — most likely its INDEX in the output `sessions` list, rather than an
empty `session_id` paired with a synthetic key that appears nowhere else.
**Do not "fix" it here by guessing a mapping from offering + slot.**

In practice the loss is currently masked — `refreshViolations()` runs after
materialize and re-derives the structural violations from the applied rows, so
the group clashes end up recorded anyway. It would NOT be masked for any
violation type the app's own evaluator cannot compute.

## Cross-repo note: calendry-solver's run registry grows without bound

The solver keeps runs in an in-memory `HashMap` with **no TTL and no eviction**,
so every run ever started stays resident until the process restarts. Not urgent
at current volumes, and not this repo's code to fix — but it is an unbounded
growth path, and the same absence of persistence is why this app captures
results eagerly and treats NOT_FOUND as terminal — see CLAUDE.md § "Stage 4: how
polling actually works".

Recorded there alongside the two consequences this app depends on, so the repo
that can fix it now knows what changing it would break here.


---

# Larger features — needs a full design pass

Surfaced by a private-university scenario walkthrough (2026-08). None of these
have any implementation yet, and none should get one without the same depth of
planning the solver's own architecture got — each is a different *shape* of
problem from anything built so far, not a variation on an existing pattern.

## Person-level self-service access model

A Person logging in to manage only their own data (availability, day
preferences) and see only their own schedule. Every current permission is
tenant-wide ("can read all sessions"); nothing today expresses "only your own
X". Needed for: lecturers self-entering `Person.blackouts`/preferences,
lecturers seeing only their own timetable. This is a real architecture gap, not
a UI gap — the permission model has no concept of row-level self-scoping.

## Public, unauthenticated access patterns

Two distinct cases, both currently impossible since the whole app sits behind
login:

- A student viewing their own (or their Group's) schedule with no account —
  needs a shareable-link or lookup mechanism.
- A lobby/kiosk display showing live room occupancy — needs a device
  credential distinct from a real user account, plus a room-centric schedule
  view (the existing grid is group/person-centric).

## Per-person soft preferences

E.g. "this tutor prefers mornings," "this tutor prefers these days if
possible." Every existing soft constraint is tenant-configured and broadly
scoped (a kind, a rank threshold); a preference belonging to one individual
Person is a new data shape (on `Person`) and needs new solver logic reading
per-person data, not just a new catalogue entry.

## Compactness / "minimize gaps in the day"

For both students (a Group's day) and tutors (a Person's day): minimize idle
blocks between the first and last session of a day. Genuinely new constraint
shape — every existing type is unary, pairwise, or an aggregate ratio; this
needs the whole set of one day's sessions for one entity, closer in kind to
`OnlineOnsiteSameDay`'s day-granularity aggregation than anything simpler, but
aggregating a continuous "gap count" rather than a boolean mix.

## Tenant "mode" (school vs. university)

A tenant-level default-behavior setting that simplifies the Offering creation
form (schools care about *which* offerings exist and are used, not entering a
`required_session_count` every term) and possibly pre-selects which constraint
types are suggested. Plus reusable Offering templates so a school doesn't
re-enter "Math, 4x/week" every term.

## Exam-specific placement logic

The inverse of `minimize_exam_week_sessions`: actively place exam-kind Sessions
*into* the exam period (ideally clustered near term-end), rather than only
discouraging ordinary lessons from being there. Plus a lecturer-facing "create
an exam for my own Offering" flow distinct from a staff "create for everyone"
flow — both need manual Session creation (see Features not built, below) as a
prerequisite.

## Lecturer consistency across an Offering's Sessions

Once a lecturer is assigned for one Session of a recurring Offering, the same
lecturer should hold every other Session of that Offering for the rest of the
term — not switch session to session. Staff can still manually override a
specific Session's lecturer; the system shouldn't fight that override on a
future re-solve. Three layered gaps, in dependency order:

1. **Prerequisite, already a known solver limitation.** Genuine lecturer-*pool*
   selection is unimplemented. `Offering.candidate_lecturer_ids` +
   `required_lecturer_count` only supports the degenerate case (pool size ==
   required count, no real choice); a genuine pool returns `UNIMPLEMENTED`
   today. Nothing can be "consistent" until the solver can choose from options
   at all.
2. **The new constraint itself.** Once pool selection exists, "same lecturer
   for every Session of one Offering" is an aggregate over an entire Offering's
   Sessions across the whole term — related to the compactness item above in
   that both need to reason about many Sessions of one entity together.
3. **Manual per-session lecturer override.** Doesn't exist yet — the schedule
   inspector currently displays Lecturer read-only. Needs its own edit path
   (like Room now has), plus a decision on whether an override "locks" that
   one Session's lecturer against a future repair-mode solve.

## Scheduling pattern per Offering (block vs. distributed)

Two competing philosophies described in the scenario:

- **Distributed/regular** — a course meets at a consistent weekly slot for
  the whole term (traditional semester model). Not currently *enforced* — the
  solver can place each week's session independently today; nothing forces
  week-to-week consistency.
- **Block/intensive** — a course's entire demand concentrated into a short,
  contiguous window (e.g. daily for 4 weeks, then done), common in some
  private/professional programs.

Neither exists in the taxonomy — `Offering` has only a flat
`required_session_count`. Real work needed: new `Offering`-level scheduling-mode
field(s), likely a new hard or soft constraint type per pattern, and solver-side
support for both.


---

# Features not built

## ~~Manual Session creation ("Events")~~ — API DONE 2026-08-23, UI still open

`POST /api/sessions` exists, gated on the new `session.create` permission.
`session.offering_id` is nullable and a NULL means the Session is an **Event**
(TAXONOMY.md §2). Verified end to end against a live solver: an Event survives a
real run + apply un-deleted and un-moved, **including when unlocked** — the
exemption is that it belongs to no Offering and therefore to no solve's scope,
not the lock.

**The UI landed 2026-08-23** as a `create` mode on the schedule grid: "Add
event" arms the grid, a slot click opens a form seeded with that day/block/week.
Gated on `session.create` and hidden entirely without it.

What is still thin, for whoever picks it up next:

- **One group and one room only.** The form offers a single select for each,
  while the API accepts arrays. Multi-select needs a real picker, and the
  multi-room case runs into the tracked wire-format gap above.
- **No people/lecturer assignment**, for the same reason — it wants a search
  control, not a `<select>` of every person in the tenant.
- **No edit or delete for an Event.** The inspector offers Move/Swap/Lock like
  any Session, but there is no `DELETE /api/sessions/:id` at all, so an Event
  created by mistake can only be removed through the database. That is the most
  likely first complaint.
- The kind picker is tenant vocabulary. Do not special-case "holiday" / "exam" /
  "gathering" anywhere; `kind` is data (TAXONOMY.md §2). The form states the
  CalendarPeriod distinction in prose and links to it, which is the only
  treatment that does not hardcode a kind.

## Cancel-to-spare-bank

Cancelling a Session (e.g. a lecturer got sick) should offer: try to find it a
new slot, or move it to a "spare bank" of unplaced-but-still-tracked Sessions.
Needs a new Session state (today a Session either has a real placement or
doesn't exist) and connects directly to the v2 minimize-movement repair mode
below — "try to find a new slot" IS that repair mode.

## v2 "minimize-movement" repair mode (calendry-solver)

The deferred, softer repair mode — penalize disturbing existing Sessions
instead of hard-locking everything outside scope. `LockPolicy.
MINIMIZE_MOVEMENT` exists in the proto, returns `UNIMPLEMENTED`.

## Full SolverInput snapshot per Generation

Today only a hash of the input is stored (enough to prove reproducibility), not
the actual constraint/settings configuration that was active. "View what was
configured when this calendar was generated" needs the real snapshot
persisted, not just its hash.

## Step 14: AccessRole management has no UI and no API

Tenant roles are editable **only by operator CLIs**: `provision:tenant` (grants
the whole catalogue to `tenant-admin` at creation), `create:role` (composes a new
role from an explicit permission list) and `grant:permissions` (backfills onto an
existing role). A tenant admin still cannot compose a role, and no route is
behind any of it:

- `access_role.manage` and `person_access_role.assign` are in the permission
  catalogue and granted to `tenant-admin`, but **no endpoint checks either** —
  they are currently unreachable code paths.
- `access_role`, `access_role_permission` and `person_access_role` are not in
  `RESOURCES` or `RELATIONS`, so the generic CRUD and relation routes do not
  serve them.

That is deliberate for Step 13 (the brief scoped it to the nine core entities)
and is the whole of Step 14. Note the shape it needs is unusual: AccessRole is
tenant data, but the permissions it bundles are *code*, so its editor is a
picker over the fixed catalogue rather than a free-form form — closer to the
constraint rule builder than to the generic scaffold.

## Import / Export / Notifications

- CSV/Excel import (onboarding institutions with legacy spreadsheet data) —
  mapping UX (guided vs. fixed template) still undecided.
- Export — iCal / Google Calendar / Outlook.
- Notification delivery — audience resolution already exists
  (`affected-persons.get.ts`); nothing actually sends anything.

## Password policy gaps

`must_change_password` is BUILT for the operator-reset path — see CLAUDE.md
§ "Open items on auth" for how that works and why. What is still missing:

- the initial password from `provision:tenant` is **not** flagged for rotation
  (a one-time stdout print that stays valid indefinitely);
- no password expiry;
- no complexity rule beyond the 12-character floor in `change-password.post.ts`;
- **no rate limiting on the change endpoint** — confirmed absent 2026-08-23;
- no email delivery of reset links.


---

# Undecided

## OPEN QUESTION — a Session whose duration spans a break

**Not decided, deliberately.** A `durationBlocks: 2` Session placed across lunch
currently renders as one contiguous span, and with a 45-minute gap inside it that
is visibly wrong. Resolving it means deciding whether such a placement is legal
at all:

- if it is legal, the Session genuinely runs longer in wall-clock terms than
  `durationBlocks × blockLengthMinutes`, and every duration display is wrong;
- if it is not, that is a new hard constraint — and the SOLVER would need to know
  about breaks to avoid producing one, which would overturn the "breaks never
  cross the wire" decision this whole feature rests on.

That second branch is why this is not a rendering tweak. It is a scheduling-
semantics question with a cross-repo consequence, and it should be answered
explicitly rather than settled by whichever behaviour someone implements first.

## Constraint params validation

`params` accepts arbitrary JSON through the generic constraint write API, same
family as the severity/weight write-boundary gaps that were closed (see
CLAUDE.md § "RESOLVED: constraint shape is now validated at the write
boundary"). Deliberately parked for later, same fix shape when it's worth
doing.

## The 100%-slot-occupancy schedule shape

Confirmed intentional (2026-08-23): the current demo schedule packs all
Sessions into fully-occupied weeks (18/18 slots for several consecutive weeks)
as a side effect of `minimize_day_usage`'s weight relative to others. Not a
bug — flagged and explicitly kept as-is. Leaving this here as a note in case a
future session finds the same shape and wonders whether it was intended.


---

# Constraint management

## Kind/offering-scoped variants are modelled and unused

`constraint_scope` holds **zero rows** across all tenants (measured
2026-08-23), so scoped variants are a modelled capability nobody has exercised.
The grid renders them as a sub-list under their type's row and the builder can
create one via `/manage/constraints/new?type=<key>`, but the scope PICKER
itself is still the generic relations panel rather than a purpose-built
control.

Worth a design pass when someone actually needs one: "cap online share at 30%,
except seminars at 50%" is the motivating case, and it wants a control that
shows the default and the exception together rather than two independent rows.

## `params` still accepts arbitrary JSON through the generic API

Unchanged by the grid work and still open — see the entry under **Undecided**.
The grid writes params through the same `PATCH /api/constraints/:id` as before,
so a malformed param set is refused by nothing. The catalogue knows each type's
parameter shape (`ConstraintParamDef`), so the fix is the same shape as
`validateConstraintShape()`: consult the catalogue in a refinement.

---

# Event log

## A tenant or Generation carrying any `session_event` cannot be deleted

Found 2026-08-23, while making `executePlan` emit DELETE events — the
materialize test's teardown started failing with
`session_event is append-only; DELETE is not permitted`.

Both FKs are `ON DELETE CASCADE`:

```
session_event_tenant_id_fkey       -> tenant      CASCADE
session_event_generation_id_fkey   -> generation  CASCADE
```

and `session_event_append_only` refuses `DELETE` unconditionally. So the schema
says "when the tenant goes, its events go" and the trigger says "no", and the
`DELETE FROM tenant` fails outright.

**This is pre-existing, not caused by the DELETE events** — `apply.post.ts` has
always written an `APPLY_GENERATION` event, so any tenant that ever applied a
Generation was already undeletable. Emitting DELETE events only made a *test*
tenant reach the same state, which is how it surfaced.

Impact is currently low: nothing in the app deletes a tenant or a Generation, so
this bites fixtures and manual cleanup rather than users. Test suites work around
it with `ALTER TABLE ... DISABLE TRIGGER`, which requires ownership — a
production purge or a GDPR-style erasure request could not.

The shape of a fix already exists: migration `20260816180000` solved the exact
analogue for `session_event.session_id` by narrowing the trigger to permit ONE
specific shape (the FK's own `SET NULL` detach) while still refusing everything
else. The equivalent here is harder because a cascade DELETE is not
distinguishable from a hand-written one inside a row-level trigger. Options not
yet evaluated: a session-local GUC the purge sets, or moving the guard to a
`BEFORE DELETE` on the parent instead.

**Do not "fix" it by dropping the trigger** — append-only enforcement is what
TAXONOMY.md §3 rollback depends on.

## `CREATE` and `DELETE` were unreachable enum values until 2026-08-23

Recorded because it explains why neither had a shape to copy. `SessionEventType`
declared all seven values, but nothing emitted `CREATE` (until `POST
/api/sessions`) or `DELETE` (until `executePlan`). `materializeGeneration()`
still writes no per-session CREATE or MOVE events — the Generation snapshot is
the record for solver-originated placements, and only removals now get their own
event, because a removal is the one change the snapshot cannot describe.

If per-placement solver events are ever wanted, that is a deliberate decision
about log volume (a 27,000-session apply would write 27,000 rows), not an
oversight.

---

# Overlaps to resolve

## `CalendarPeriod` vs. an Event, for holidays

Both can express "the 14th is a holiday" and they mean different things.
`CalendarPeriod` (HOLIDAY/BREAK/EXAM) colours a **range of dates** and is what
`minimize_exam_week_sessions` and the academic calendar read. An Event occupies
a **room and a block**. TAXONOMY.md §2 now states the rule — *range of dates →
CalendarPeriod; room and block → Event* — but nothing enforces it, and the
manage UI offers both without explaining the difference.

Worth revisiting when the Event UI is built: a "create event" flow that lets
someone place a campus-wide holiday as a 1-block Session in one room would be
technically valid and semantically wrong.

---

# Tech debt

Deliberately deferred, with the reasoning, so these are not rediscovered as
surprises. None of these block current work.

- **Periodic re-verification of older tracked "known issue" entries.** Nothing
  checks the prose in CLAUDE.md/BACKLOG.md against the code they describe, and
  more than one entry has already been found stating something the code no
  longer does (or never did) — the three "missing" indexes, most notably. What
  the pass is: walk the entries in both files and for each one confirm against
  current code whether it's still true, already fixed, or was never accurate.
  Entries most at risk are the ones asserting a *reason* ("this backs X", "this
  is needed because Y") rather than a plain fact. Deliberately NOT bundled into
  whatever change discovers the next stale entry — it's a substantial standalone
  review. Per-entry verification at the point of use covers the interim.

- **Design-token retrofit (deferred by decision, not oversight).** Step 10
  established the token scale and wired its emission, but did not convert
  existing components. Remaining hardcoded literals, re-measured 2026-08-23:
  35 font-size, 17 border-radius, 67 spacing values across `app/components/`.
  New work uses tokens; this is a standalone design-system pass whenever it's
  worth doing.

- **Impeccable's state directory collides with its own install path.** The
  skill expects `.impeccable/` at the repo root to hold *per-project* state,
  but that path is the vendored skill submodule itself. Design work through the
  skill has to substitute a manual choice round and say so. Fix by relocating
  the submodule and repointing `.claude/skills/impeccable`.

- **`CommonButton` accepts ONE variant it does not style: `secondary-875`.**
  Passed by `ViewMenu.vue`; the prop union was widened to make `nuxt build`
  typecheck pass — the type error was a real signal that has been silenced,
  not solved.

- **`docker-compose-next.yml` cannot start.** Declares
  `depends_on: redis: condition: service_healthy` but defines no `redis`
  service. Both compose files also declare an unused `redis_data` volume.

- **Repo hygiene.** The `Init` commit tracked `.agents/`, `.claude/` and
  `skills-lock.json`, and added `.impeccable` as a git submodule.
  `.gitignore` now lists these, but ignore rules don't apply to already-tracked
  files — they need `git rm --cached`, and the submodule needs deliberate
  removal.

- **`db-drop` applies `schema.prisma` DIRECTLY and is a live footgun.**
  `prisma db push --force-reset` produces a database with every table and **no
  RLS, no triggers, no `SECURITY DEFINER` functions**. Deliberately kept as an
  explicit escape hatch rather than deleted. Options if ever worth closing:
  rename it to read as dangerous, or make it refuse unless an env var is set.