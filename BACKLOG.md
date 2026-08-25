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
- [x] **AccessRole / permission management UI (Step 14) — COMPLETE.** Compose a
      role from the fixed permission catalogue, grant it from the Person page,
      and neither route can leave a tenant unable to administer itself. Closed
      three things found on the way: `provision:tenant` had been failing on a
      duplicate permission key since `calendar-periods` was added, `systemFlag`
      was UI-only so the provisioned roles were deletable over the API, and six
      relation pickers were gated on less than their own option wave needed
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

## Tracked gap: a tenant/Generation carrying any session_event cannot be deleted

Surfaced during Events work (2026-08), not caused by it — `APPLY_GENERATION`
events have existed since Stage 3, this was just never exercised before
Events introduced the first per-Session `DELETE` events.

Both `session_event`'s FKs (to `tenant`, to `generation`) are `ON DELETE
CASCADE`, but the append-only trigger refuses every `UPDATE`/`DELETE` on the
table — including the ones the CASCADE itself would need to perform. So a
tenant or Generation with any event history literally cannot be removed
through normal means; test suites work around it with `DISABLE TRIGGER`,
which needs ownership, so a real production purge has no path at all.

**Fix shape, by precedent:** the same narrow-permit pattern already used for
`20260816180000_session_event_detach_on_session_delete` — permit exactly the
CASCADE's own shape of mutation (nulling the FK column, or here, allowing the
CASCADE delete itself to proceed) while keeping event *content* immutable.
Not yet designed in detail; this is a real gap worth closing before this ever
matters in production, not before.

## Tracked, needs a decision: locale-aware date formatting — is this i18n's
## first slice, or standalone?

Built (2026-08): server-resolved (`Accept-Language`, not `navigator.language`)
locale-aware weekday/date formatting on the schedule (day headers, inspector),
`useState` carrying the server's resolved locale into hydration so SSR and
client agree by construction, UTC pinned in every formatter so the viewer's
locale decides how a date is spelled, never which date it is. Fixed an
`Intl`-related point-free bug along the way (`.map(weekdayShort)` passing an
array index as the locale argument) and a stale `blockTime()` call in the
inspector that ignored `dayOfWeek` (same class of bug as the schedule-grid
break-rendering fix).

**Undecided:** is this the first slice of the parked i18n effort above, or a
narrower, standalone "correct date formatting" fix that doesn't imply UI
chrome translation is coming? These are genuinely different in scope — this
work is mechanical `Intl` formatting with no translated strings involved, i18n
is a full UI-copy sweep. Needs a decision so this doesn't get silently
conflated with (or silently excluded from) the i18n item above.



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
4. **Staff pre-assignment before generation (added 2026-08).** Staff should be
   able to assign a specific lecturer to a specific Group's Offering *before*
   a solve runs, as an alternative to leaving lecturer selection to the
   solver's pool logic or to chance — e.g. "this teacher stays with this
   class all year." A different entry point (pre-solve, staff-driven) into
   the same underlying need as items 1–3; design together with the pool-
   selection prerequisite, not separately.
5. **New question, made reachable by the Offering-split fix (added 2026-08).**
   An Offering with 2+ Groups attached now produces N independent parallel
   session series (one per Group), not one combined session — see TAXONOMY.md's
   Offering correction. That means "must every parallel series share the same
   lecturer, or may each pick independently?" is now a real, reachable
   question once genuine lecturer-pool selection exists (item 1), where
   previously there was only ever one combined series to assign a lecturer
   to. Design this together with items 1–2, not as an afterthought once pool
   selection lands.

## Explicit combined-group teaching (elective/track merging) — CONFIRMED
## working; the gap is tooling, not data model

Real scenario (2026-08): several source Groups (e.g. five classes) each let
students choose a track (IT vs. Management); students choosing IT across all
five classes should be taught together as one genuinely combined group,
explicitly — not incidentally, because a room happened to fit everyone.

**Confirmed end-to-end, no schema change needed.** Built a real fixture (a
root "X-Elective" Group, six students drawn from two unrelated cohorts, each
holding two Memberships) and proved capacity, attendee resolution, and
`PersonDoubleBooking` all behave correctly — including proof-by-falsification
(disabling the person rule re-introduced exactly the clashes it exists to
catch). Nothing needed beyond existing `Group`/`Membership`/
`offering.group_ids` mechanics.

**The confirmed gap is tooling.** Building this fixture took six individual
`PUT /persons/:id/groups` calls, one per student, each replacing that
person's *entire* membership set — there is no bulk add/remove, and
`ManageGroupTree` shows structure and `expectedSize` only, with no membership
editor on the Group side at all. For a real elective of 30 students drawn
from four cohorts, that's 30 individual round trips through a UI built for
one-at-a-time editing. Worth its own design/build pass: bulk membership
management on the Group side (add/remove many Persons at once), not a new
data concept.

## i18n / internationalization (client UI chrome, full sweep when started)

Not started. Decided so far (2026-08): scope is client-side UI chrome and the
app's own fixed catalogue labels (e.g. `shared/constraintTypes.ts`'s built-in
descriptions) — never tenant-entered open vocabulary (Role/Group/kind names,
custom constraint names), which stays free text regardless of display
language, per the standing fixed-vs-open taxonomy principle. Server-generated
messages (validation errors, etc.) are deliberately OUT of scope for now —
client chrome only. When started, it's a full sweep (convert everything at
once), not incremental — a long coexistence of translated and un-translated
strings was explicitly rejected as more confusing than doing it properly in
one pass.

**Real, unresolved design questions before any sweep starts:**

- Library/mechanism choice for Nuxt (e.g. `@nuxtjs/i18n`) — not evaluated yet.
- Where does a "current locale" preference live? Likely a preference on
  Person/Account, falling back to a Tenant default, falling back to a global
  app default — mirroring how other per-person preferences would eventually
  work, and connecting to the still-undesigned person-level self-service
  access item above.
- **Real SSR risk, worth taking seriously given this project's history.**
  Nuxt i18n has known SSR/locale-detection ordering pitfalls, and this
  codebase has hit the "a watcher/async-resolved value is wrong at first
  render, corrects after hydration" bug shape four separate times already
  (edit forms, `<select>`, the solver control, week navigation — see
  Conventions in CLAUDE.md). Locale must be resolvable synchronously at first
  render, not detected client-side after the fact, or this becomes bug number
  five in that exact pattern.
- Given the scale (a full sweep across every existing component), this likely
  warrants its own dedicated multi-session effort rather than a single
  dispatch — closer in size to a solver-slice-style build than a normal
  feature task.



A real university timetable (screenshot, 2026-08) shows session start/end times
that don't align to any coherent fixed block grid — e.g. a session running
10:00–12:00 nested inside a visually-labelled "9:00–12:15" period, alongside
period lengths that vary block to block (60 min, 195 min, 90 min, 90 min, 90
min in the same day) and a Session ("Stat1", 13:00–16:15) that spans straight
across a 15-minute break — direct, concrete confirmation of the already-tracked
"Session whose duration spans a break" question in Undecided, not a
hypothetical edge case.

**Promising direction worth testing first, before assuming a bigger
rearchitecture is needed:** every boundary in the real example is a multiple of
15 minutes. If so, this might be solvable by adopting a much finer base
`blockLengthMinutes` (e.g. 15) rather than needing arbitrary/continuous-time
placement — a "long" or "short" period then becomes an ordinary Session with a
different `durationBlocks` at the same fine granularity, which the schema
already fully supports, rather than a new per-block custom-length concept in
`TimeGrid` itself. The non-uniform breaks feature already handles the gaps
between macro-periods.

**Real cost to weigh, not free:** a finer base unit multiplies the solver's
slot count per day (more slots → larger occupancy bitmatrices, more candidates
scored per repair), directly working against the careful performance tuning
already measured (slice 5/6 benchmarks). Whether that cost is acceptable at
real institution scale needs actual measurement, not assumption.

**Working answer for the break-spanning question (B), reasoned through but not
yet verified against real code:** the solver never needs to care — it only
ever reasons in block indices, regardless of what wall-clock gap sits between
them. The likely fix lives entirely on the rendering side: a Session's
*wall-clock* end time should be computed by walking forward `durationBlocks`
teaching-blocks through the same shared `blockBoundaries()` the grid already
uses for row geometry, rather than raw `durationBlocks × blockLength`
arithmetic — so a break falling inside a Session's span is naturally absorbed
into a longer wall-clock duration, with `durationBlocks` continuing to count
teaching blocks only. Reuses existing infrastructure rather than inventing a
new concept.

**Working answer for visual grouping (C):** likely resolves for free once (B)
is fixed, since row heights are already proportional to real minutes — the
one thing actually worth checking is whether the grid currently draws a
divider line at every fine block boundary regardless of whether anything
changes there, versus only at real Session/break boundaries. If it's the
former, that's a small, contained fix, not a redesign.

**(D) solver performance at finer granularity is unresolved and can't be
reasoned to an answer — needs real benchmarking once (A) is investigated.**



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

## Manual Session creation ("Events") — mostly built, one gap remains

**Built (2026-08):** `POST /api/sessions` (creation, gated on `session.create`,
via `fitsGrid()`), `DELETE /api/sessions/:id` (scoped to Events only —
Offering-linked Sessions correctly refused with a 409), multi-group selection
(reused `ManageRelationPicker`, the same component Offering management uses),
and a required `title` field (refused for Offering-linked Sessions, required
for Events — closed the "Untitled session"/empty-banner bug as a side effect).

**Still open:** no edit path. Once created, an Event's `kind`, Room, Groups and
People cannot be changed — only its placement (via the existing move flow).
Correcting a mistake means delete-and-recreate.

## A searchable person picker

The Event inspector and the Event creation form both pick people with a plain
`<select multiple>` over EVERY person in the tenant. That is fine for the demo's
twenty and wrong for a real institution's thousands — the list is unusable long
before it is slow, and there is no way to find someone by name.

Shipped that way deliberately: an Event nobody can be added to was the worse
gap, and the scaling limit is visible rather than silent (the inspector says so
above forty people). The proper control is a type-to-search field backed by the
existing `q` filter on `/api/persons`, which already does substring matching —
so this is a UI component, not new API surface.

Both call sites should move together, and the Offering page's lecturer picker
(`ManageRelationPicker` with `extraReference`) is the third consumer worth
looking at while doing it: it has the same problem one entity over.

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

## The FORM's reference wave is not permission-gated

The sibling of the relation-option gap that Step 14 closed, in the other
composable, and deliberately left open because the same answer does not work.

`useEntityForm` fetches one list per `reference` field in a single
`Promise.all` — and those endpoints carry their own permissions, which the
page's gate does not imply:

    offerings form  ->  /api/terms          term.read
                        /api/session-kinds  session_kind.read
                        /api/roles          role.read
    terms form      ->  /api/time-grids     time_grid.read

A caller holding `offering.read` but not `term.read` takes down the whole wave.
Worse than the relation case: the ROW is fetched in that same `Promise.all`, so
`row` is null, the draft seeds empty, and the edit form renders **blank inputs
over a record that has data** — the Step 13 SSR bug's exact symptom, from a
different cause.

**Why the relation fix does not transfer.** Relations are omitted when their
options are unreachable, because a missing picker is honest. A `reference` field
cannot be omitted: `termId` is REQUIRED on an Offering, and a create form
silently missing it produces a 400 the user cannot act on. The plausible answers
are (a) gate the whole page on the union, as `/schedule` does via
`schedulePermissions.ts`, naming what is missing; or (b) render the field as
static text showing the stored id with a note that resolving it needs
`term.read`. (a) is consistent with the schedule precedent and blunter; (b) keeps
partial editing possible and is more code.

Not urgent: every seeded role that can reach these pages today also holds the
reads. It becomes reachable the moment a tenant composes a narrow role through
the new editor — which Step 14 has just made easy, so this should not sit
indefinitely.

`tests/manage-relation-gates.test.ts` covers the relation side only. Whichever
answer is chosen, the form side needs the equivalent, and the check has to read
the rendered VALUES rather than count inputs — counting is how the original
Step 13 instance survived a whole phase.

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