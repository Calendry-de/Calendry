# DECISIONS.md — Calendry

The **archive** half of this project's persistent memory, split out of CLAUDE.md
on 2026-08-26 because that file had grown past the point a session can absorb
in one read (~2,100 lines) — see CLAUDE.md's own "writing effective CLAUDE.md"
research for why that matters.

**What lives here vs. what stays in CLAUDE.md:** CLAUDE.md keeps the standing
rule, the number, the invariant — whatever a session would actually break by
not knowing. This file keeps the *story*: how a bug was found, what was
measured, why the obvious fix was wrong, what was verified and how. Deleting
this content would delete the argument, not just the bug — the same reasoning
that used to justify keeping it inline in CLAUDE.md still applies; it has just
moved to a file that isn't read every session, because none of it is needed to
avoid regressing something CLAUDE.md's live rules don't already state on their
own.

**Same drift risk as BACKLOG.md, arguably worse.** Nothing in the repo
references an entry here, so nothing contradicts one when it goes stale.
Treat everything below as "this is what happened and what we found," not as a
live claim about current code — verify against the code before relying on a
specific detail (function name, line count, measurement) for a decision.

---

# Database & migrations

## `db-reset`'s accidental migration, in full

`db-reset` ran `migrate dev` until 2026-08-23. The script was
`migrate reset --force && migrate dev --name init && generate`. `reset`
replays the committed migrations correctly; `migrate dev` then diffs
`schema.prisma` against the rebuilt database, sees hand-written objects the
schema language cannot declare (RLS policies, triggers, `SECURITY DEFINER`
functions, partial indexes), and emits a migration to DROP them. That is the
exact provenance of `20260813190131_init`, which contains nothing but three
`DROP INDEX` statements and is applied.

This file used to say "`db-reset` used to `rm -rf prisma/migrations`; it no
longer does" — true, and misleading, because the removed half was never the
dangerous one. `migrate dev` is what caused the damage; it's now gone from the
script (`migrate reset --force && generate`).

## The three "missing" indexes — resolved by measurement, not migration

The accidental `20260813190131_init` migration (above) dropped three indexes
and is applied:

```
session_room_conflict_idx     ON session_room   (room_id, session_id)
session_person_conflict_idx   ON session_person (person_id, session_id)
session_event_replay_idx      ON session_event  (tenant_id, generation_id, created_at, seq)
```

They were measured before being recreated, and the evidence said not to.

**The first two were tracked against a query shape that does not exist.** The
original migration comment said they back "the room/person collision lookups
in `refreshViolations()`". They do not. Every site that touches these tables
drives off `session_id`, never `room_id`/`person_id`: `violations.ts`
(`sessionId: { in: involvedIds }`), `solverInput.ts` (`include: { rooms,
people }`), `move.post.ts`, `generationMaterialize.ts`,
`affected-persons.get.ts`. Stage 7a's `no_double_booking_person` is no
exception — it builds attendee sets from session-keyed reads plus
`membership`. All of them are already served as **index-only scans** by
`session_room_pkey (session_id, room_id)` and `session_person_pkey (session_id,
person_id)`, and any future point lookup by room or person is covered by the
existing single-column `session_room_room_id_idx` /
`session_person_person_id_idx`. So these are not premature — they are the
wrong shape, and adding them costs write amplification on tables every
editing route writes.

Measured on a probe schema at solver scale (27k sessions, 27k `session_room`,
54k `session_person`), not the 65-row dev tenant:

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
seeder deletes them raw, and there is no read path anywhere in `server/`,
`app/` or `scripts/` — no rollback or audit-history route is built. At 205k
events the natural plan uses the existing `session_event_generation_id_idx`
(0.653ms); with the tracked index it is 0.660ms, because a bitmap scan
discards ordering and it still sorts. Forcing an ordered `Index Scan` on a
5,000-event generation does remove the sort (1.643ms → 0.862ms), so the shape
is right — but that is 0.8ms on a query that does not exist, for an 11 MB
index. Add it in the same change as a future replay reader, where the ordered
scan can be verified against the real query instead of guessed at.

This is the entry CLAUDE.md's "tracked-gap entries drift" rule was written
from — the original description was accurate to an intention the code never
took, not to the code as it is.

---

# Landing page / routing

## Making `/` public: what a test caught rather than a person

Two things this touched, both verified after the fact rather than
anticipated:

- `tests/login-flow.test.ts` had pinned `/` as a protected page (the
  assertion now names `/dashboard`, and a new one asserts the root serves
  publicly).
- The header-nav check in `tests/page-renders-per-role.test.ts` fetched `/`
  purely as "a page with the default layout" — against the `empty`-layout
  landing page it found no nav and would have reported every role as
  correctly not offered the `/my` section.

## The landing page ↔ BACKLOG.md test, falsified deliberately

`tests/landing-page.test.ts` parses the § "Current phase" checklist out of
`BACKLOG.md` and asserts the unchecked entries are exactly the ones the page
presents as not built, with a guard that the parse found something (a renamed
heading would otherwise make every assertion pass over an empty list).
Falsified deliberately during construction: ticking `Import (CSV/Excel)` in
BACKLOG.md without touching the page fails it, naming the mismatch.

---

# "Guards must fail loudly" — the case log

CLAUDE.md's Conventions section keeps the rule itself. This is the run of
instances that built it — worth skimming before writing a new guard/detection
condition, since the same shape keeps recurring in new disguises.

- **The `/my` section was fully built, fully tested, and unreachable.** Both
  new pages worked perfectly — routes resolved, middleware gated correctly,
  content rendered — and every one of 501 passing tests fetched them by URL
  directly. None asserted the section was actually reachable by navigating
  there, because the header hub entry for the section was never added
  (`useHeaderNav()` renders from entries carrying `inHeader: true`; the two
  page entries were added, the section's own hub entry was not). Fixed by
  adding the missing hub entry, gated on the same permission the pages
  themselves require, and pinned by a test asserting the header **in both
  directions** — present for a role that holds the gating permission, absent
  for one that doesn't, with a control entry (`Home`) asserted present in
  both cases so an empty/broken header can't pass by looking like "correctly
  hidden." General form: route tests prove a page can be fetched; they do not
  prove a person can get there. A new top-level section needs its own
  reachability assertion.
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
  genuinely is none. Fixed with `active?.[0]`. In JS the empty-collection
  case needs `.length` or an index, never a bare truthiness test.
- **Absence that only proves the page failed (Stage 6b).** The first
  permission check asserted the solver control was missing for a viewer —
  and it was also missing for the admin, because of an SSR bug (see
  "SSR/watcher bugs" below). A test for "affordance absent" must also assert
  the surrounding page RENDERED, or it passes for the wrong reason. The fixed
  check reports `schedule rendered=True solver control=False`.
- The three "missing" indexes (see "Database & migrations" above) — a
  constraint tracked against a query shape that never existed.

The counter-example to copy: provisioning against an unseeded database fails
on a foreign key and writes nothing. Loud, specific, unmistakable.

---

# `--fix` tooling rewriting files outside scope — Step 13 instance

`bun run stylelint:fix` was run to clean up new components and silently
modified 8 files the step never touched — five schedule components,
`schedule.vue`, `layout.scss` and `schedule-panel.scss`. Most of it was
harmless property reordering, but it also rewrote `rgba(124, 89, 188, 0.55)`
→ `rgb(124, 89, 188, 0.55)` in `ScheduleGrid.vue`, a *value* change inside the
file whose grid placement had just been debugged. It was caught by reading
`git diff --name-only`, not by any check — build, typecheck, eslint and all
45 tests passed with it in place.

---

# SSR/watcher bugs — the case log

CLAUDE.md keeps the generalized rules ("Vue does not flush watchers during
SSR", "`<select>` needs `:selected`"). This is the run of instances.

- **Step 13 edit forms.** A `watch(data, seed, { immediate: true })` runs
  exactly once on the server — at setup, before the fetch resolves — and
  never again. This rendered every management edit form with *empty inputs*
  over records that had data; the client re-seeded on hydration, so it showed
  as a flash and a hydration mismatch rather than an error. It survived a
  whole phase because the check counted `<input>` elements rather than
  reading their `value`.
- **Stage 6b, `filters.termId`.** Seeded by a `watchEffect` in
  `useScheduleData`, so during SSR it is still `''` while the page renders.
  The solver control gated on it (`v-if="canTriggerSolver && termIdModel"`)
  and was therefore absent from the server-rendered page for a user who had
  every permission for it, appearing only after hydration. Fixed by exposing
  `resolvedTermId` — which falls back to the term the fetch actually used —
  and gating on that instead.
- **TimeGrid `<select>`.** `value` is a property, not an attribute, so server
  rendering drops it and the browser falls back to the first option. A Term
  that had a TimeGrid rendered as "— None —" until hydration corrected it —
  the page stating the opposite of the truth.

---

# Solver: `MinimizeRoomRank` gains `invert` — full record

"Spare the best rooms" only ever penalized `room.rank >= rank_threshold`.
When asked for the opposite ("prefer higher-ranked rooms for lessons"), a
parameter was chosen over a new catalogue type — deliberately: two separate
types (`MinimizeRoomRank` / `MaximizeRoomRank`) could both be enabled
simultaneously, penalizing high and low ranks at once, a contradictory
configuration nothing would prevent, since each type gets its own default row
and the one-default-per-type index only governs within a single type. A
direction parameter makes that unrepresentable. Same trajectory as
`MinimizeBlockUsage` absorbing `MinimizeFirstBlock`/`MinimizeLastBlock`, and
`MinimizeDayUsage` absorbing "minimize Saturday."

**Wire:** `MinimizeRoomRank` gains `bool invert = 2` (field 1,
`rank_threshold`, unchanged). `false` (default) = penalize `rank >=
threshold` — spare the best rooms. `true` = penalize `rank <= threshold` —
prefer them. Confirmed old peers keep their exact meaning: encoding
`{rank_threshold: 2}` with no `invert` produces `ba01 02 0802` under both
0.4.0 and 0.5.0, decoding to `invert: false` either way. Published as
`calendry-proto@0.5.0`.

**Version-history correction:** the `MinimizeBlockUsage` entry previously
recorded that version as `0.3.0`; it actually shipped in `0.4.0`. Nothing was
published between 0.2.0 and 0.3.2 — those three tags point at the same commit
(`7856748`, byte-identical proto trees). `0.4.0` (`506dacd`) is the commit
that actually added `MinimizeBlockUsage`.

**Solver-side grading, not just a boolean branch.** Implementing `invert`
surfaced that `MinimizeRoomRank` was the first constraint type to need a
*graded* penalty rather than a flat per-instance weight: a room 8 ranks past
the threshold should cost more than one 1 rank past it, or the search has no
gradient to descend. A new `severity()` function (0.0..=1.0, normalized
against the room set's own rank span) scales this rule's contribution; every
other constraint type still returns `1.0`.

**The 0.0..=1.0 cap is load-bearing.** `hard_penalty = sum(all soft weights) ×
placements + 1` depends on that sum bounding what any achievable soft
configuration can cost — see the negative-weight incident below for what
happens when that bound is violated. A raw distance multiplier (unbounded)
would break the same guarantee from the other direction.

Measured, before → after, same inputs (ranks 0,1,2,3,10, threshold 2, 6
lessons): `[0,0,1,1,10,10]` → `[0,0,1,1,2,2]` — the search now fills outward
from the least-bad room and leaves the extreme one empty.

New tenants are now provisioned with `invert: true` in
`minimize_high_ranking_rooms`'s seeded params. `enabledByDefault` itself
stays `false`, unchanged from every other non-structural type — flipping a
rule's direction for a tenant that already has it configured is safe;
enabling a previously-off rule for everyone is not. Catalogue label renamed
from "Spare the best rooms" to "Steer room choice by rank."

---

# Solver: warn-and-allow — the full reasoning

A run that reaches `RUN_STATUS_SUCCEEDED` but still carries residual hard
violations is still offered as an applicable Generation, surfaced through the
same `constraint_violation` mechanism manual edits already use. Not silently
discarded, not auto-applied. `Generation.apply` still requires an explicit
human action regardless of violation state.

**Consequence: `GenerationStatus.INFEASIBLE` is effectively unused for solver
output, and that's not an oversight.** Warn-and-allow means a SUCCEEDED run
carrying residual hard violations is still `READY` and still applicable, and
a run that never succeeded produces no Generation at all
(`shouldCreateGeneration()` admits only SUCCEEDED). The status stays in the
enum for import and for a future solver that reports infeasibility as a
first-class outcome.

This is parity with the manual-edit rule (hard-constraint violations warn,
they do not block), and matches the wire protocol: `RunStatus` deliberately
describes the run's lifecycle, not the solution's quality — exactly as
`ExactFrequency` (unplaced Sessions) and `MaxOnlineShare` (share breaches)
already do.

Confirmed against a live solver, Stage 1: an over-constrained snapshot (60
sessions demanded into a 40-slot grid) returned `RUN_STATUS_SUCCEEDED`,
`termination_reason=move_budget`, objective 21, 40 placements and 2
`ExactFrequency` hard violations — rather than failing the run.

---

# Solver: Federation scope — superseded design note

Historical: two Federation mechanisms were decided in principle and
deliberately NOT implemented before Stage 7. Both are now implemented — see
CLAUDE.md's "Federation-shared room occupancy" and "Federation-shareable
Sessions" for what actually shipped.

- `ExternalOccupancy` (occupancy of Federation-shared Rooms by other tenants)
  — resolved via a parameterless `SECURITY DEFINER` function, not a
  cross-tenant ledger.
- `Session` becoming federation-shareable — resolved with the Session row
  shared but participant links (`session_group`, `session_person`) staying
  tenant-private, a deliberate narrowing of the TAXONOMY.md amendment's
  literal wording.

---

# Solver: determinism & `maxMoves` tuning — the measurement

`Budget` carries both `max_wall_millis` and `max_moves`; whichever is hit
first ends the run. `SolveStats.termination_reason` reports which one
(`"move_budget"`, `"time_budget"`, `"converged"`, `"cancelled"`).

**Why the default moved 50,000 → 30,000,000.** The old default was stopping
most real solves at roughly 21% of the distance to convergence. Measured
serially at seed 42 (solver restarted between runs, to avoid the idempotency
trap — see below):

| `maxMoves` | termination | moves | elapsed | objective |
|---|---|---|---|---|
| 5,000,000 | move_budget | 5,002,752 | 886 ms | 441.9 |
| 10,000,000 | move_budget | 10,000,384 | 1,773 ms | 431.6 |
| 20,000,000 | move_budget | 20,000,256 | 3,603 ms | 430.0 |
| 30,000,000 | **converged** | 23,791,104 | 4,293 ms | 430.0 |
| 50,000,000 | converged | 23,791,104 | 4,283 ms | 430.0 |

The real term converges at 23.79M moves in ~4.3s; 50M buys nothing further
once converged while costing ~9s on anything that doesn't converge.

**Why the wall-clock cap moved alongside it, 10s → 30s.** Only `move_budget`
and `converged` terminations are reproducible; `time_budget` is not. At
~5.5M moves/s, a non-converging instance reaches 30M moves in ~5.4s, which
left only 1.85× headroom against the old 10s cap — hardware roughly twice as
slow would hit the wall-clock cap first and lose reproducibility on exactly
the runs that most need it. The wall cap is a safety net, not the intended
terminator.

**Stale-comment correction made in the same change:** the old code comment
claimed small instances "converge out long before five million moves,"
reasoning from a *stagnation limit* (counts iterations) as if comparable to
the move budget (counts moves) — not the same quantity, and this tenant's
real term needs 23.79M moves to converge.

**Idempotency reminder for anyone re-measuring this:** the key is
`<inputHash>:<seed>` and does not include the budget. Two calls with the same
input/seed but different `maxMoves` return the *same* run — the solver must
be genuinely restarted between measurements, or every "new" run silently
replays the first one.

## Idempotency key — why protobuf, not JSON, and a real trap it caught

`POST /api/solver/runs` sends a SHA-256 of the ENCODED `SolverInput` plus the
seed as `StartRunRequest.idempotency_key`. The hash is over the encoded
protobuf, not a JSON rendering: two inputs that encode identically are the
same problem to the solver, which is exactly the question being asked; a
JSON hash would also move with key order and with how BigInt happened to
stringify. Anything that deliberately changes the problem MUST change the
key, or the solver returns the earlier run and the new one is never
observed — this bit during Stage 3 verification, when a stress variant
reused the key and silently got the previous, easy run back.

## Both determinism and warn-and-allow, confirmed against a live solver (Stage 1)

- **Determinism.** Two runs of an identical snapshot at seed 42 produced
  byte-identical placements, objective and termination reason. A third
  terminal reason beyond the two in the guarantee: `converged`, when the
  constructive heuristic lands a zero-objective solution in 0 moves — as
  reproducible as `move_budget`.
- **Warn-and-allow.** See "Solver: warn-and-allow" above.

---

# Solver: Stage 2 established — the full verification, and two traps

Three behaviours were verified against a live solver rather than reasoned
about:

- **Concurrency is enforced by the database.** Three simultaneous POSTs to
  the same term returned one 201 and two 409s naming the winner. The rule is
  the partial unique index, not a `findFirst` — two parallel requests would
  both pass an application check and both insert.
- **A failed StartRun resolves its own row.** Solver down → 502, row
  `FAILED`, zero active runs. The row is written as `PENDING` *before*
  StartRun so the index can reject a concurrent second attempt during the
  call, which creates the obligation to resolve it.
- **A poll failure is deliberately NOT a run failure.** `GET /runs/:id` with
  the solver down leaves the status untouched and returns `stale: true`.
  Marking it `FAILED` would destroy a live run's record *and* free the index
  for a second concurrent run.

Two traps found while building it:

- **A 23505 aborts the Postgres transaction.** Nothing may query it
  afterwards. Looking up the conflicting row inside the same transaction
  returned `500 current transaction is aborted` instead of a clean 409 — and
  only a genuinely *parallel* test surfaced it; a sequential one passed.
- **ts-proto emits `uint64` as `string`, not bigint.** `toWireU64` /
  `fromWireU64` in `solverClient.ts` are the only place that conversion
  happens.

**`RUNNING → CANCELLED`, resolved in Stage 3b/3e.** Tracked as unverified
through Stage 2 because `CancelRun`'s already-terminal and
never-acknowledged paths both passed, so cancel *appeared* to work from
every route tested, while the run that matters — a genuinely in-flight one —
had never been interrupted. Now verified twice: directly against the solver,
and through `POST /api/solver/runs/:id/cancel` (`RUNNING`, 6.2M moves,
objective 1095 → `cancelled=true` → `CANCELLED`). Note what it took: the demo
tenant's real data converges in ZERO moves (48 sessions into 760 slots is not
a search problem), so the transition only became observable after demand was
raised far above capacity.

---

# Solver: Stage 4 polling — traps and one consequence

**Claiming is a lease, not a lock — and the first design was wrong twice
over.** The original design used a session-scoped `pg_try_advisory_lock` to
elect a single poller. Caught before building: session locks belong to a
CONNECTION and Prisma pools connections, so the "leader" would not reliably
hold anything; and holding it across the gRPC calls would keep a transaction
open across a network call. What actually works: a short transaction pushes
`next_poll_at` into the future for the rows it takes, using `FOR UPDATE SKIP
LOCKED`, so concurrent instances take disjoint sets. `pg_try_advisory_xact_lock`
remains, scoped tightly around the claim and released at COMMIT, purely to
stop a same-tenant stampede. Verified: four concurrent claimers, six due
runs, zero duplicate claims, and the work becomes claimable again once the
lease expires.

**Consequence worth remembering:** during a solver outage the effective
retry interval is the 30s claim lease, not the adaptive cadence, because a
failed poll deliberately writes nothing at all. A run therefore takes up to
~30s after the solver returns to resolve.

---

# Solver: virtual room capacity-1 bug — cross-repo fix record

Fixed in `calendry-solver` at `99b41e3`; `vendor/calendry-solver` points at
it. `Occupancy` (`solution.rs`) held a binary `BitMatrix` over (rooms ×
slots) with no capacity dimension, and `check_pair`'s `RoomDoubleBooking`
branch reported on `rx == ry` — neither consulting `is_virtual`. The
solver's half was the damaging one because it constrained the SEARCH: one
online Session per slot, tenant-wide, during construction and LNS both.

The fix keys on the flag via a single `Room::is_exclusive()` predicate both
layers consult. `capacity` still gates eligibility and was deliberately left
alone — a virtual room with a genuine concurrency limit still cannot be
expressed.

**It exposed a real gap, now tracked in the solver repo rather than here.**
The bug had been enforcing `MaxOnlineShare` by accident: virtual rooms are
the overflow valve when physical rooms are full, and capacity-1 held that
valve nearly shut. Removing it more than doubled share violations at
large-university (180 → 455) with structural violations unchanged at exactly
80 and `unplaced` still 0 — the model is now correct and the search is
visibly worse at respecting a cap it was never actually respecting. See
BACKLOG.md § "Needs a decision, not a design pass" for candidate fixes.

---

# `violations.ts`: membership-down vs. conflict-both-ways — how the rule was found

Two opposite failure directions were found in the same function.

**Under-reporting, closed by Stage 7a.** `no_double_booking_lecturer`
intersects `session_person` rows directly, and misses a clash via membership
of two *unrelated* Groups, where `conflictGroupIds()` connects nothing.
`no_double_booking_person` closes it by expanding both sides to their
attendee sets (direct participants plus every DESCENDANT group's members)
and intersecting by identity.

**Over-reporting, closed in Stage 5.** The group check expanded the conflict
closure of BOTH sides, so any two Groups sharing an ancestor always
intersected at that ancestor — see "Stage 5" below for the measured scale.

The rule CLAUDE.md keeps: membership flows DOWN, conflict flows BOTH WAYS.
`attendeeSets` uses `descendantGroupIds` while `conflictSets` uses
`conflictGroupIds`; swapping either for the other reintroduces one of the
two bugs above.

---

# Stage 5: two pre-existing bugs it uncovered

Neither was introduced by Stage 5. Both had gone unnoticed for the same
reason — nothing had ever exercised the code path.

**1. A Session with history could not be deleted at all.**
`session_event.session_id` is `ON DELETE SET NULL`, chosen so an audit row
outlives the Session it describes. But `deny_mutation()` refused every
`UPDATE OR DELETE` on `session_event` — and the FK's SET NULL *is* an
UPDATE:

```
DELETE FROM session WHERE id = <a session that has any event>;
ERROR: session_event is append-only; UPDATE is not permitted
```

It survived because until Stage 5 nothing in the codebase deleted a Session —
there is no `DELETE /api/sessions/:id`, and `materializeGeneration()`
removing solver-rejected placements is the only such call.

Fixed by `20260816180000_session_event_detach_on_session_delete`, which
narrows the trigger to permit exactly one shape: an UPDATE that sets
`session_id` and/or `counterpart_session_id` from a value to NULL with every
other column byte-identical. Repointing either column at a *different*
Session, changing any other column, a detach smuggled in alongside another
column, a no-op UPDATE, and DELETE are all still refused — pinned by 11
tests in `tests/session-event-append-only.test.ts`. `ON DELETE CASCADE` was
rejected (destroys the audit trail); `RESTRICT` was rejected (contradicts
unplaceable Sessions being removed rather than left at refused placements).

**2. `no_double_booking_group` flagged any two Groups under a shared root.**
`describeCollision()` intersected the EXPANDED conflict closure of *both*
Sessions. Every group expands to include its ancestors, so two groups
sharing any common ancestor always intersected there — however unrelated:

```
Seminar A1 → {Seminar A1, Class A, Informatics 2026}
Class B    → {Class B,            Informatics 2026}
∩          = {Informatics 2026}   ← a false positive
```

Fixed by expanding **one** side and intersecting against the other side's
DIRECTLY assigned groups by identity, mirroring the solver's own
implementation. Scale of the bug, measured on the over-constrained Stage 5
schedule: the old code would have flagged 390 sibling-only pairs on top of
the 18 genuine ones; on the ordinary 48-Session demo schedule, 24 phantom
violations where the correct answer is zero. Three independent sources
agreed on the fix: a closure query in SQL (18 pairs / 36 sessions), the app
evaluator (36 rows), and the solver (18 `GroupDoubleBooking` violations).
Regression pinned by `tests/violations-group-conflict.test.ts`.

---

# Solver run result recovery — full incident record

Found in Stage 6b verification. One run ended like this:

```
status=SUCCEEDED  generation_id=NULL  termination_reason=NULL  has_result=f
```

A SUCCEEDED run is supposed to always produce a Generation. This one
produced none, because `result` was never captured. **What happens is
confirmed; the root cause is not** — it coincided with cancelling a run that
had just completed, so `CancelRun` and the terminal
`GetStatus(include_result=true)` overlapped. The plausible mechanism is that
cancel caused the solver to drop the finished run's result before the app
asked for it, but that was never proven.

**The recovery gap that mattered:** `pollSolverRun()` deliberately records
the terminal status even when the result fetch throws (losing the transition
would be worse). But nothing ever retried — the background poller claims
only `PENDING/QUEUED/RUNNING`, and `GET /api/solver/runs/:id`
short-circuits on `isTerminal(run.status)` before polling. So a terminal row
with no result was never looked at again, permanently unusable.

Stage 6b's `deriveState()` maps SUCCEEDED-without-a-Generation to the
`failed` branch (the UI says "The run failed" rather than hanging), but also
made the race reachable from a button — a user pressing Cancel at exactly
the wrong moment.

**Fixed by `20260817120000_solver_run_result_recovery` and
`recoverRunResult()`:**

- Discovery needed THREE gates widened, not one — besides the claim, the
  `SECURITY DEFINER` `tenants_with_due_solver_runs()` also filtered on
  active statuses, and the poller never visits a tenant that function does
  not name.
- The predicate names SUCCEEDED explicitly — "terminal and missing a
  result" would have chased 16 FAILED and 4 CANCELLED rows that correctly
  have none.
- `status` is never rewritten — the run DID succeed; the capture failure
  gets its own `result_lost_at`/`result_recovery_attempts` fields rather
  than a new status value.
- `NOT_FOUND` short-circuits the retry budget (marked lost on attempt 1); only
  `unreachable` consumes the 5-attempt budget (5s/15s/60s/300s backoff).

Verified against a real corpus: the four genuinely stuck rows that had
accumulated in the dev database were all resolved to `result_lost` at
exactly attempt 5. A separately seeded run was recovered end-to-end.

---

# Stage 6c: why the review screen shows two panels and no delta

`violations.current` comes from `constraint_violation`, filled using only the
structural double-booking rules (`STRUCTURAL_CONSTRAINT_TYPES`, four).
`violations.proposed` is the solver reporting on all 14 constraint types —
different measurements of different things. Measured: on the same
over-constrained timetable the solver reported 23 hard violations, and after
applying, `refreshViolations()` recorded 36 session-scoped rows plus 5
offering-scoped. An arrow between those numbers would invent a comparison
that does not exist, so the screen renders two labelled panels naming their
own source, with an explicit line that they are not a like-for-like
difference. A true delta needs a dry-run evaluator (running the app's own
evaluator over proposed placements without writing them) — real future
scope, not built.

---

# Accounts & roles: why the operator CLIs exist

`provision:tenant` creates a tenant and its first admin. Nothing could add a
SECOND account to an existing tenant, or a new AccessRole, which is why
`vic@demo.local` became a hand-inserted SQL artifact and `ntill@gmx.de`'s
password was set by hand — and why verification work kept borrowing and
resetting the real admin's credential.

**Both are now resolved through real paths, no raw SQL anywhere:**

- `ntill@gmx.de`'s password: replaced via `bun run reset:password`, which
  hashes through the real `hashPassword()`, revokes every session, sets
  `must_change_password`, and emits an audit line.
- `vic@demo.local` and `viewer6b@calendry.local`: created through
  `bun run create:role` + `bun run create:account`. Their role holds **six**
  permissions, not the seven originally written down — vic's live
  `GET /api/auth/session` reported six (`session.get.ts` returns
  `loadPermissions()` verbatim, unfiltered), meaning one original INSERT
  never landed. The measurement overrides the written record:
  `group.read, person.read, room.read, session.read, term.read,
  time_grid.read`. Recreated as six deliberately, matching what the 6b/6c
  evidence was actually gathered against.

**`create:role` verification, why the owner connection is used but writes
stay app-role-scoped:** `access_role`, `access_role_permission` and
`person_access_role` are ordinary tenant-scoped tables carrying
`tenant_isolation` (both USING and WITH CHECK), so the app role writes them
happily once `calendry.tenant_id` is set. What the app role *cannot* do is
resolve `--tenant <slug>` to an id (`tenant`'s RLS policy requires already
knowing which tenant you are), so the owner connection resolves the slug and
the transaction then drops to `SET LOCAL ROLE calendry_app` with tenant
context before writing anything — narrowing the write PATH, not the
credential. A fifth `SECURITY DEFINER` lookup to avoid this was considered
and declined: "an operator CLI would like a nicer argument" isn't a
comparably strong reason to the four real RLS exceptions. Pinned by
`tests/access-role-writability.test.ts`, whose negative cases are the point.

There is deliberately no `--all` flag — `provision:tenant` already mints a
full-catalogue `tenant-admin`, so a second one is an unaudited second
superuser role per tenant, and a role granted "everything" once silently
stops being everything the next time a permission is added.

---

# Management area (Step 13) — verification detail behind the standing rules

CLAUDE.md keeps the standing rules (permission-gating shape, bespoke-slot
rule, `custom: true`, relations-are-PUT-set-sub-resources). This is what was
found while building and verifying them.

**`paramField()` had already diverged in two places** — the grid's copy
silently dropped `required`/`min`/`max` and the `(%)` relabeling the
builder's copy kept. Unified into `app/utils/constraintFields.ts`.

**Deprecated constraint types were invisible, not merely unmarked.**
`entriesFor()` and `missingTypes` both iterated `defaultConstraintTypes()`,
which filters out anything with `deprecatedBy` — correct for *seeding* a new
tenant's baseline, wrong for *rendering* the catalogue. Proven by inserting a
legacy `minimize_first_block` row into a live tenant: the API returned 14
rows, the page rendered 13, the label appeared nowhere except the hydration
payload. Fixed — deprecated rows now render, toggle, and persist correctly
while disabled, grouped into a "Superseded rules" subsection.

**`vartorgba` is not a real Sass function — a misspelling silently inert in
ten files.** The generated helper is `varToRgba` (case-sensitive lookup).
Found via the constraint grid's SOFT badge (white text, no background), the
same dead spelling was present in `ManageWeekdayPicker`,
`ManageRelationPicker`, `ManageConstraintBuilder`, `ManageEntityForm`,
`ManageGroupTree`, `ManageList`, `ManageDeleteDialog`,
`ManageTimeGridBreaks`, `CommonCommandPalette`, and `CommonInputText`.
Consequences beyond the constraint badge: the delete-confirmation modal's
scrim/shadow, the Ctrl+K palette's scrim and active-row hint colour, the
weekday picker's selected-day chip, list badge tints and error states,
relation-picker error banners, and the input placeholder colour were all
silently inert. Fixed in all ten, verified against the actual served CSS per
component — 25 distinct `(token, alpha)` pairs checked, zero mismatches. (The
three occurrences inside `ManageConstraintGrid.vue`'s own code comment,
quoting the wrong spelling to contrast it with the right one, were
deliberately left as-is.)

**The read-only render path had never been exercised.** No seeded role
previously held `constraint.read` without `constraint.update`, so nobody had
ever exercised the "`.read` without update/create/delete → visible,
read-only, static text not disabled inputs" convention for this page. A
test-only account, `cviewer@calendry.local`, was created; a test now asserts
every catalogue rule renders, zero editable toggles, zero weight inputs, no
`disabled` attribute anywhere, create affordances absent — falsified
deliberately by re-rendering with a disabled checkbox instead of static text
(fails three of four assertions).

---

# Academic calendar periods — why the preview earns its place

The mapping from two dates to week kinds is genuinely unpredictable, and this
is not hypothetical: a real probe period (2027-09-27 → 2027-10-18) marked
**four** weeks `EXAM`, not three, because `EXAM` uses a "touches" rule (the
week beginning 2027-10-18 counts on its Monday alone) while
`BREAK`/`HOLIDAY` use "covers the entire week" instead — the same dates give
a different answer depending on the `kind` chosen. Nobody reading two dates
predicts that.

**Why this feature closed a long-standing dead end.** `calendar_period` had a
table, a Prisma model, an RLS policy, a mapper and a wire field since the
initial schema — and no way to write a row, in any tenant. Consequence: no
week was ever classified `EXAM` anywhere, so `minimize_exam_week_sessions`
reported zero violations while looking enabled and healthy, indistinguishable
from "working and satisfied." Raising its weight from 5 to 1000 (a
workaround tried before the real cause was found) multiplied zero by two
hundred and changed nothing — proven directly: a probe exam period inserted,
then a solve at weight 5 and at weight 1000, produced byte-identical
placements.

**Verified end to end, closing the loop.** An exam period created through
the API for the first time returned the week kinds on the wire as `…10:
TEACHING 11:EXAM 12:EXAM`, and a solve at the ORIGINAL weight of 5 placed
zero sessions in weeks 11 and 12, redistributing all 65 into earlier weeks.
Before this, the same term spread evenly across all 13 weeks including those
two.

---

# Group↔Term scoping — measurement behind the design decision

CLAUDE.md keeps the full design reasoning (many-to-many not ownership,
fail-open, reference-derived solver filter) since it is genuinely
load-bearing. This is just the verification record:

Backfill scoped the two real cohorts and left the other eight universal; the
API narrows by `termId` correctly, including the two scoped cohorts excluded
from another Term; the picker narrows the same way, checked against a
server-rendered page (not just presence); the solver received exactly the
referenced Groups plus closure (3, not 2 — the closure correctly pulls in
the parent) with an independent SQL computation over `group_closure`
agreeing exactly; and an invariant assertion on real assembled input shows
zero dangling group references and zero orphaned `parentId`s in both
directions, for both a populated and an empty Term.

Before this, `assembleSolverInput` sent every tenant Group on every run
(10 sent, 2 referenced on the demo tenant), and the Offering editor's Group
picker offered every Group regardless of the Offering's Term. The tenant was
already encoding the Term into the Group's name ("dIT22 S1 4.Semester") for
lack of anywhere else to put it — the requirement asserting itself through a
text field.

---

# Bootstrap & deploy: the production image's five blockers

`ghcr.io/mindcollaps/calendry` had never been built or booted before
2026-08-26. Each blocker was invisible until the previous one was fixed —
kept here because the *consequences* (now permanent in the Dockerfile/CI) are
what CLAUDE.md states as current fact; this is how they were found:

1. **`docker build` could not read its own context.**
   `docker-compose.dev.yml` bind-mounts `./db/` as the Postgres data
   directory, so once the dev stack has run, the repo root holds a
   root-owned directory and every build dies with `error from sender: open
   db: permission denied`. Now in `.dockerignore`, with `vendor/` (1.5 GB,
   mostly the solver's Rust `target/`) and `.output`.
2. **`COPY .config/wordlists` had no source** — a template leftover.
3. **`prisma.config.js` imported `dotenv/config` unconditionally**, and the
   runner has no application `node_modules`, so `migrate deploy` failed on
   the config's first line. Now optional.
4. **`npm install -g prisma` cannot satisfy `prisma.config.js`'s `import
   "prisma/config"`**, and cherry-picking `node_modules/@prisma` out of the
   builder misses transitive deps (`effect`). The toolchain is installed in
   the runner against a *generated minimal manifest* — installing against
   the real `package.json` resolves the whole app graph and fails on a
   nitro/vite peer conflict.
5. **`prisma db seed` runs `bun`, and the runner is a node image.** The bun
   binary is copied from `oven/bun:1-alpine`; the alternative was a second,
   node-shaped seed command that could drift from the one developers run.

Verified against a throwaway Postgres with `.config/db-init` mounted:
migrations ran, 56 permission rows seeded, `/health` 200 and `/` 200. The
runner is `node:22-alpine` because a Prisma 7 dependency declares
`node >=22`. The registry credential reaches the build as a BuildKit secret
at `/root/.bunfig.toml`; no token appears in `docker history` or the image
filesystem.

**Two CI traps hit for real:**

- `secret-files`, not `secrets`. `secrets` takes `<id>=<inline value>`, so
  `id=bunfig,src=/path` was passed through as an id literally named `id`.
  The mount resolved to nothing and `bun install` failed with an opaque 401
  six layers in.
- `PACKAGES_READ_TOKEN` must be a classic PAT with `read:packages`; the
  registry refuses fine-grained tokens.

---

# The `calendry_internal` schema — why it was actually necessary

Not hypothetical: naming the helper schema `calendry` (matching the owner
role) silently put all 35 tables in the wrong schema and broke `prisma
migrate reset`, because PostgreSQL's default `search_path` is
`("$user", public)`, so a schema named `calendry` captures every unqualified
`CREATE` issued by that role — including Prisma's own `_prisma_migrations`
table, created *before* any migration SQL runs. `reset` drops only `public`
and leaves the helper schema behind, flipping the resolution order on the
second run.

---

# `MinimizeBlockUsage` — verification note

Verified with a real live solve after publishing `calendry-proto@0.3.0`:
`minimize_block_usage` correctly avoided the configured blocks — proven
against a real encode of the new proto message, not just a unit test against
a plain object cast.

---

# `weekCountOf` vs. `weeksInTerm` — two definitions of "weeks in a term"

`weekCountOf` (`shared/academicCalendar.ts`, Monday-anchored:
`floor((mondayOf(end) − mondayOf(start))/7) + 1`) and `weeksInTerm`
(`app/composables/schedule.ts`, raw span: `ceil((end − start)/7)`) computed
the same question differently, and agreed only when a term happened to start
on a Monday.

Confirmed on a real term (Wintersemester, Sat-start, 2027-10-02 →
2027-12-23): the classifier, the calendar-period UI, the solver's calendar
assembly, and `POST /api/sessions`'s own validation all agreed on 13 weeks
via `weekCountOf`; the schedule toolbar alone rendered "Week 1 / 12" via
`weeksInTerm`, making week 13 reachable server-side (`POST /api/sessions`
with `termWeek: 13` returned 201) but invisible in the UI at any URL,
including `?week=13`, which silently clamped back to 1.

`weeksInTerm` is deleted; the toolbar now calls `weekCountOf`. Regression
test in `tests/schedule-first-render.test.ts` uses a Saturday-start term and
asserts the two formulas disagree on those exact dates before comparing the
rendered count.

A related, currently-harmless duplication was also found and resolved:
`solverInput.ts` and `solverCalendar.ts` each independently computed a
Monday-anchored week INDEX for a given date — no live disagreement, but the
same shape with no shared helper. Extracted into `weekIndexOf` in
`shared/academicCalendar.ts` (2026-08-25), with `weekCountOf` itself now
expressed through it.

---

# `CommonButton` rendered a `<div>` — accessibility fix record

It rendered a `<div>` with a click handler, so every action built on it —
the whole schedule inspector, the solver control, the palette — was
mouse-only: no Tab, no Enter/Space, not announced as a button. `getTag` now
defaults to `'button'` (including the disabled case, so assistive tech hears
"unavailable" rather than nothing).

Two things that made this less trivial than it looks:

- `type` was already taken by the visual variant (`primary`,
  `secondary-black`…), so the native button type needed its own prop:
  `nativeType`, defaulting to `'button'`. Without that default, changing the
  tag would have turned every button inside a `<form>` into an accidental
  submit.
- `login.vue` and `change-password.vue` depended on native submit — they
  passed `tag="button"` with NO `@click`, relying on the form's
  `@submit.prevent`. They now pass `native-type="submit"`.

A native `<button>` also inherits the UA font rather than the page's, so
`font: inherit` was added to `.button`.

---

# Pre-launch branding sweep

The Step 1 rebrand searched only for the `xxx-changeme` placeholder pattern,
so anything the template author hardcoded under a different name survived
it; `Swindler` (the page title and header text) was found by accident while
building the login UI. A full case-insensitive sweep across all three repos
found exactly one further instance: `bun.lock` still recorded `"name":
"xxx-changeme"` for the workspace, because `bun install` does not rewrite
that field when it disagrees with `package.json`. Fixed by hand,
re-verified with `--frozen-lockfile`.

Everything else was clean: `package.json` metadata, README, `robots.txt`,
`useHead` titles, layouts, devcontainer, both compose files, `.config/`, and
both sibling repos.

Two vatsim-radar attributions in `modules/styles.ts` and
`app/scss/variables.scss` are deliberately KEPT — provenance for borrowed
code, not branding.
