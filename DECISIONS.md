# DECISIONS.md — Calendry

The **reasoning** half of this project's persistent memory. Three files, three
different jobs, and keeping them apart is what stops any of them rotting:

| | Holds | Rots when |
|---|---|---|
| `CLAUDE.md` | The standing **rule** — the invariant, the number, whatever a session would break by not knowing. | It grows past one read. |
| **This file** | **Why** that rule exists: how a bug was found, what was measured, why the obvious fix was wrong. | It duplicates the other two. |
| [The project board](https://github.com/users/MindCollaps/projects/4) | The **work** — what is open, what it needs, what is still undecided. | Nobody checks a card against the code. |

**The division was sharpened on 2026-08-29**, when the board's cards stopped
being pointers to these files and became self-contained. Everything about *what a
piece of work is and what it still needs* now lives on its card. What stays here
is only what a future session needs in order to **change a live rule safely** —
the argument, not the changelog. Several sections shrank accordingly, and three
that were pure history were removed outright.

So: **do not restate a card here, and do not restate this file on a card.** Two
copies of a claim in a project this size is not redundancy, it is a future
contradiction with no way to tell which half is stale.

**Read a named section before changing what it covers; do not read this file
front to back.** CLAUDE.md's rules point here by section name (`§ "…"`), and
those pointers are a contract — renaming a heading breaks a reference nothing
else will catch. `server/utils/solverInput.ts` carries one too. The index below
is the entry point.

**Treat every entry as "what happened and what we found", not as a live claim
about current code.** Prose is checked by nobody. Verify a function name, a path,
a line count or a measurement before relying on it — and if you find one that has
drifted, fix it here in the same change. Four were found and fixed in the last
week alone: a `server/utils/` path for a file that lives in `server/plugins/`, an
instruction to return `{}` where `{}` throws, a claim that `params` accepted
arbitrary JSON hours after it stopped, and a solver ADR quoting a move budget the
app had already raised six hundredfold.

That failure mode is not hypothetical here. **Five board cards in one week turned
out to describe work that was already done** — the solver image, two backfills, a
role assignment, and the solver's run registry. Check the code first; it is free.

## Index

| Area | Sections |
|---|---|
| Database, schema, deploy | Database & migrations · The `calendry_internal` schema · A federation-shared Session · Bootstrap & deploy |
| Recurring failure shapes | "Guards must fail loudly" · SSR/watcher bugs · `--fix` tooling · `weekCountOf` vs. `weeksInTerm` |
| Landing page & routing | Landing page / routing |
| Permissions & accounts | `session.read_own` · `tenant.read` and `generation.read` · Accounts & roles · Accounts in the management area · Screens |
| Management area | Management area (Step 13) · Academic calendar periods · Group↔Term scoping · Group availability windows |
| Solver: behaviour | Solver: warn-and-allow · Solver: determinism & `maxMoves` · Solver: Stage 2 · Solver: Stage 4 polling · Solver run result recovery · Solver: virtual room capacity-1 · `violations.ts` |
| Solver: constraints | `MinimizeRoomRank` gains `invert` · `MinimizeBlockUsage` · Per-person preferences · Stage 5: two pre-existing bugs it uncovered · `PersonPreferenceFit.roles` · Constraint `params` at the write boundary |
| Solver: operations | Solver & proto: operational detail |
| Schedule UI | Schedule display standards · Grid geometry · The schedule toolbar · TimeGrid breaks · A Session that spans a break · Stage 6c: why the review screen shows two panels |
| Odds and ends | `CommonButton` rendered a `<div>` · The 100%-slot-occupancy schedule shape · Two vatsim-radar attributions |

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

## The landing page ↔ BACKLOG.md test, falsified deliberately — SUPERSEDED

**This guard no longer exists.** Kept because the technique is worth copying and
because what replaced it is strictly weaker, which is a thing to know rather than
discover.

*What it was:* `tests/landing-page.test.ts` parsed the § "Current phase"
checklist out of `BACKLOG.md` and asserted the unchecked entries were exactly the
ones the page presented as not built — with a guard that the parse had found
something, since a renamed heading would otherwise make every assertion pass over
an empty list. Falsified deliberately during construction: ticking
`Import (CSV/Excel)` in `BACKLOG.md` without touching the page failed it and
named the mismatch.

*Why it is gone:* `BACKLOG.md` was retired on 2026-08-28 in favour of a GitHub
project board, which no test can read. The test was rewritten to read
`app/utils/landingContent.ts` instead.

*What that costs, exactly:* it cross-checked **two independent sources**, so it
could catch the page drifting from reality. It now compares the page against a
module in the same commit, so it can only prove **page and module agree** — never
that either matches what is actually built. Module and reality can drift freely
and silently. That is why editing `BUILT`/`NEXT` when a card moves to Done is now
a **rule in CLAUDE.md** rather than a test failure: the mechanical check is gone
and a human promise replaced it.

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
- **An objective total of 118.5 with a soft rule both off and on** — which reads
  as "the term was never added" and meant "the term was added and satisfied". A
  single number served both answers; the per-constraint breakdown plus a
  deliberately unsatisfiable run separated them. See "Per-person preferences:
  stages 5–7" below, which also records a starved search imitating a rule that
  does not fire.

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

## The pattern to copy

First-render state comes from the AWAITED promise, never from a watcher:

```ts
const asyncData = useAsyncData(key, fetcher);

// Seeds before first render, server-side included.
await asyncData;
seed();

// Later client refreshes only.
watch(() => asyncData.data.value, seed);
```

In a page, hold the `await` at the top level. In a composable, do NOT — an
`await` inside detaches it from the Nuxt instance; return the handle and let the
page await it. Generalisation: anything a watcher seeds is `undefined` at first
render server-side, so prefer `computed` over a watcher-assigned `ref` whenever
first render depends on the value.

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
seed as `StartRunRequest.idempotency_key`. A caller that sent no seed learns
which one was used from `StartRunResponse.seed`, which is what makes a run
reproducible after the fact rather than only in advance. The hash is over the encoded
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
alone — there is no `concurrentCapacity` field yet, so a virtual room with a
genuine concurrency limit still cannot be expressed.

**It exposed a real gap, now tracked in the solver repo rather than here.**
The bug had been enforcing `MaxOnlineShare` by accident: virtual rooms are
the overflow valve when physical rooms are full, and capacity-1 held that
valve nearly shut. Removing it more than doubled share violations at
large-university (180 → 455) with structural violations unchanged at exactly
80 and `unplaced` still 0 — the model is now correct and the search is
visibly worse at respecting a cap it was never actually respecting. See
the project board for candidate fixes — the card is
`MaxOnlineShare is not enforced by the search`.

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

# `session.read_own`: the six-permission schedule, and what was actually wrong

## The requirement that could not be expressed

"A lecturer should see their own timetable" was not a small permission change. It
was blocked by `/schedule` demanding SIX reads — `session.read`, `term.read`,
`time_grid.read`, `group.read`, `room.read`, `person.read` — every one of which
had a good reason:

The page assembled its own reference data from five CRUD endpoints, in one
`Promise.all`, to put names on chips. A single 403 in that wave rejected the whole
handler and the page rendered BLANK. That happened twice, in two disguises, and
the fix both times was to widen the gate so the denial was at least STATED rather
than inferred from an empty screen. `SCHEDULE_PERMISSIONS` and
`missingSchedulePermissions()` existed for exactly that.

Correct for the symptom, wrong for the product. It meant the smallest role that
could look at a timetable held the authority to enumerate the entire staff
directory, every room and every cohort. The real fault was never the permission
list: **drawing a schedule and querying the institution were being served by the
same endpoints**, and no arrangement of keys over those endpoints could have
separated them.

## What replaced it

`GET /api/schedule/context`, behind the schedule's own gate, returning:

- the FRAME — every Term, every TimeGrid with its breaks. Complete, because the
  term picker must offer every term and a Term names the grid the whole page is
  drawn on. Neither says anything about a person.
- NAMES for the rooms, people and groups **appearing in the sessions this caller
  can see**, derived from them rather than listed. So a lecturer learns which
  room they are in and who leads the lecture, and learns nothing else — the
  narrowing is a property of the query, not a filter somebody maintains.

The directory endpoints keep their own keys and WIDEN those same lists from "what
this caller can see" to "everything the institution has".

**The filters were gated on those keys first, and that was wrong.** It failed in
precisely the case the whole change was for: somebody reading their own timetable
holds none of `group.read` / `room.read` / `person.read`, and may well have
sessions across three cohorts — narrowing to one of them is exactly what a filter
is for, and the permission version removed the control. The options come from the
schedule they can already see, so there was never anything left to gate; the
option list IS the boundary.

The rule that replaced it is a count: **a filter exists when it has more than one
thing to choose between**, plus "or is currently narrowing", so an active filter
can never vanish and strand the view. That also retires the empty-select case for
everybody, including administrators — a select offering only its own placeholder
claims the institution has no rooms, and a select with one option cannot narrow
anything.

`SCHEDULE_PERMISSIONS` collapsed from six required keys to one clause holding two
alternatives. That is not a relaxation — it is the list finally describing what
the page reads, which it now does BY CONSTRUCTION rather than by being kept in
sync with a fetch wave nobody re-reads.

## The three things that could have gone silently wrong

**The direction of the group walk.** Attendance flows DOWN: a Session assigned to
a Cohort is attended by everyone in its Seminars (TAXONOMY.md §6). So "is this
session mine" starts from the Groups I am a MEMBER of and walks UP —
`ancestorGroupIds`, added for this. `descendantGroupIds` would answer the other
question and hand a Cohort member every seminar's private sessions, and it would
pass every test on a fixture whose groups are flat. `tests/schedule-scope.test.ts`
seeds a sibling seminar precisely so that mistake fails. This is the same trap
`violations.ts` already has a rule about, in a third disguise.

**Two definitions of "visible".** `/api/sessions` and `/api/schedule/context` must
agree exactly, because the second publishes names for whatever the first returns.
Wider, and it names a room in a session the caller cannot read — silently, since
nothing on screen shows it. Narrower, and a chip renders a raw uuid, which is
merely ugly. So there is one function, `sessionReadScope()`, and the test asserts
the agreement rather than each side separately.

**The nav entry could not say "either".** `NavEntry.permission` was
`string | readonly string[]` meaning ALL, evaluated by a local `.every()`. Passing
a nested array for the any-of case would have been truthy per element and
`held.has([...])` false for everybody — the schedule would have vanished from the
whole institution's navigation, with no error. Upgraded to `PermissionRequirement`
and `satisfiesPermissionRequirement`, the shape and evaluator the manage
relations' gates already used. Existing flat arrays keep meaning ALL, so nothing
else moved.

## Naming: why `session.read` was not renamed

The request was "a permission to view your own schedule and a permission to view
the schedule of others". The second already existed. Minting `session.read_any`
alongside `session.read` would have left two names for one authority; renaming it
would have silently stripped the capability from every hand-composed role in every
existing tenant, since `grant:permissions --all-missing` only repairs
`tenant-admin`. So `session.read` kept its key and had its DESCRIPTION sharpened
to say what it actually grants — a role author choosing between the two needs the
difference in the words, and the words were "View the schedule".

## `member`: a default that is not a default

Provisioning now creates a `member` AccessRole holding `session.read_own` and
nothing else. Three deliberate restraints:

- **Exactly one permission.** Adding `availability.manage_own` would be
  defensible and is not provisioning's call — a default that quietly grants two
  things is how a default stops being read.
- **Not `is_system`.** That flag means "the tenant must not delete this", true of
  the last administrator and false of a suggestion.
- **Not auto-assigned to new People.** Granting authority is
  `person_access_role.assign` and belongs to a human decision on the Person page.
  A generic CRUD route that granted a role on every insert would be privilege
  escalation wearing a default's clothes. This does mean creating a Person still
  leaves them with nothing until somebody assigns the role — that is the
  remaining half of the "a new person can do nothing" complaint, and it is a
  deliberate stop rather than an oversight.

## One thing the tests caught about the tests

An assertion on server-rendered HTML matched a TEMPLATE COMMENT. The comment
added above the schedule's filters explained the change by quoting the option
labels ("All groups"), and Vue emits template comments into the SSR output — so
"the page does not contain All groups" failed against a page that correctly
omitted the select. Worth knowing generally: **prose inside a `<template>` is
part of the response body**, and a comment that quotes user-facing strings is a
comment a test can match.

## Two ways to read a schedule, and why the page needs nothing else

`session.read` is the institution's whole timetable. **`session.read_own` is the
caller's own** — sessions they are attached to, plus sessions assigned to a Group
they belong to. It is the `member` role provisioning now ships, and the reason it
could not exist before is worth keeping:

- **`/schedule` used to require SIX permissions** (`session.read`, `term.read`,
  `time_grid.read`, `group.read`, `room.read`, `person.read`) because it
  assembled its own reference data from five CRUD endpoints to put names on
  chips. So the smallest role that could look at a timetable held the authority
  to query the entire staff directory — and "a lecturer sees their own schedule"
  was unexpressible. DRAWING and QUERYING were being served by the same
  endpoints.
- **`GET /api/schedule/context` separates them.** It returns the frame (every
  term, every TimeGrid with its breaks) plus names for the rooms, people and
  groups **derived from the sessions the caller can actually see** — behind the
  same gate as the schedule itself. The directory endpoints keep their own keys
  and widen those same lists to the whole institution.
- **A FILTER EXISTS WHEN IT HAS MORE THAN ONE OPTION — never because of a
  permission.** Its options come from the schedule the caller can already see, so
  there is nothing left to gate: the option list IS the boundary. Somebody
  reading their own timetable across three cohorts gets a Group filter; anybody
  whose list holds one entry does not, because narrowing to the only value there
  is changes nothing, and a select offering only its placeholder claims the
  institution has none. An ACTIVE filter always renders regardless, or a control
  could vanish while still narrowing the view. Gating these on
  `group.read`/`room.read`/`person.read` was the first attempt and was wrong in
  exactly the case the feature was for.
- **`sessionReadScope()` is the single definition of "visible"**, shared by
  `/api/sessions` and `/api/schedule/context`. They must agree exactly: a context
  wider than the session list publishes a name for something the caller cannot
  read, silently, since nothing on screen would show it.
- **"My own" walks the group closure UP** (`ancestorGroupIds`). Attendance flows
  DOWN — a Cohort's lecture is attended by its Seminars (TAXONOMY.md §6) — so
  "is this session mine" starts from the Groups I am a MEMBER of and asks whether
  the Session names one of them or an ancestor. `descendantGroupIds` here would
  show a Cohort member every seminar's private sessions, and looks correct on any
  flat fixture. Same trap as `violations.ts`; pinned by
  `tests/schedule-scope.test.ts`.
- **Query filters compose with the scope, never replace it.** A `read_own` caller
  passing `personId=<somebody else>` gets the sessions they share, not that
  person's.
- **`NavEntry.permission` is now an AND of ORs** (`PermissionRequirement`, the
  shape the manage relations already used), evaluated by
  `satisfiesPermissionRequirement`. A bare string is one key, a flat list is ALL,
  a nested list is ANY. The schedule needs the last of those and a local
  `.every()` would have been silently false for everybody.
- **`member` is NOT `is_system` and is NOT auto-assigned.** It is a suggestion a
  tenant may rename or delete, and granting authority stays a human decision
  behind `person_access_role.assign` — a CRUD route that granted a role on every
  insert would be privilege escalation wearing a default's clothes. Existing
  tenants need it made by hand: `bun run create:role -- --tenant <slug> --key
  member --name Member --permissions session.read_own`.

---

# `tenant.read` and `generation.read`: what the navigation exposed

## The report

Two entries in the manage navigation — **Display** and **Proposals** — were both
gated on `session.read`. Each had its own written justification and each was
defensible in isolation:

- display settings "carry no tenant data of their own, only instructions for
  rendering data the caller can already see";
- a proposal "shows the same placements the schedule already shows".

Put side by side in one nav list, they stopped being defensible. `session.read`
reads as "may view the timetable" and is the permission a lecturer holds. What it
was actually granting was: this institution's own configuration page, and every
schedule the solver had ever produced for it — including runs nobody applied.
Neither is a lecturer's business, and nothing on screen suggested they were being
offered anything unusual.

The general shape, now a standing rule in CLAUDE.md: **borrowing an existing
permission because minting one is expensive works until something puts the
borrowed key next to what it now controls.** Both justifications above answer
"who happens to be looking at this data?" and neither answers "whose data is
this?".

## Three keys, not two

`tenant.read` and `generation.read` were requested. `tenant.update` was added on
top, and that decision is the one worth recording.

Display settings were WRITTEN under `session_kind.update` — borrowed on the
reasoning that colours already live on Session kinds. Once the page had a gate of
its own, that pairing described a role which may change this institution's
settings and never see the page it changes them on. That asymmetry is treated as
a bug everywhere else in this codebase, and once one key had to be minted the
second cost nothing but a line in the same backfill.

`tenant` is deliberately NOT in `CRUD_RESOURCES`: a Tenant is not a managed
entity from inside itself, so there is no `tenant.create`/`tenant.delete` and the
prefix rule generates none. Two keys, matching what a tenant actually decides.
Its own catalogue CATEGORY rather than `administration`, because every future
tenant-level setting belongs there and a heading that reads "Tenant" is what
tells a role author these are not about people or rooms.

## The endpoint stayed wider than the page, deliberately

`GET /api/display-settings` accepts `tenant.read` **OR** `session.read`.

Narrowing it to `tenant.read` looks like the tidy answer and is the wrong one.
The endpoint has a second caller: `scheduleData.ts` reads it to resolve session
colours, and that fetch is TOLERANT by design — `.catch(() => DISPLAY_DEFAULTS)`.
So narrowing it would not deny anybody a page. It would draw every lecturer's
schedule in default colours, silently, with nothing distinguishing "this tenant
never configured any" from "you were refused". That is the
"no-data and fetch-failed render identically" failure this codebase keeps writing
rules about, and it would have been introduced by a change whose whole purpose
was to tighten something.

Same divergence `access-roles` and `accounts` already carry, in both directions:
the section's gate and the endpoint's list are separate questions.

`tests/auth-permissions.test.ts` § "still lets a schedule viewer read the colours
it needs to draw" exists to stop somebody tidying this later.

## `generation.read` is not implied by `generation.apply`

The catalogue has no implication mechanism, so a role holding only the apply key
would be able to promote a proposal it cannot look at. Both are granted together
in practice; the catalogue must not pretend that is structural.

`session.read` is deliberately NOT required on top of `generation.read` for the
preview, even though a preview returns placements. A Generation is a set of
PROPOSED placements — a different data set from the applied timetable — and
demanding authority over the live schedule to read a proposal would make "may
review proposals" unexpressible on its own. That role is exactly the department
head PRODUCT.md names as the reviewer, and it was unexpressible before this:
`tests/page-renders-per-role.test.ts` now seeds one (`generation.read` and
nothing else) and asserts it reaches `/schedule/proposals` and is refused
`/schedule`.

## Two things this turned up on the way

**A test asserted the wrong direction and had to be flipped.** "offers a route to
proposals from the schedule and the palette" asserted that the viewer — holding
only `session.read` — DOES see the proposals link, with the comment "session.read
alone is the gate, and the viewer holds it". It was a correct test of an
incorrect design, and it is the closest thing to a record that the old behaviour
was deliberate rather than accidental. The viewer is now the negative case in
that same test.

**The solver panel told a lie for a missing permission.** `ScheduleSolverControl`
fetches the Generation its run produced to decide whether to offer "Review", and
its failure branch rendered `generationStatus === 'APPLIED' ? 'Applied.' :
'Discarded.'` — so a null status printed **"Discarded."**. Before this change
that was reachable only through a dropped request; `generation.read` makes it
reachable through a permission, since `solver.trigger` and `generation.read` are
separate keys and "may start a run, may not read its output" is a composable
role. Now four distinguishable facts, and the fetch is skipped rather than
attempted-and-caught so the hint can say which one applies.

## Consequences a future session should not undo

- Display and Proposals must NOT be re-gated on `session.read`, however
  reasonable each looks alone.
- `GET /api/display-settings` must keep accepting `session.read`.
- Both moved keys need `grant:permissions --all-missing` on every existing
  tenant, and a hand-composed role holding `session_kind.update` for display
  writes loses that capability silently — CLAUDE.md § "Bootstrap & deploy".

---

# Accounts in the management area: reversing "only a CLI may mint accounts"

## What the old stance was, and what it actually cost

`create:account` and `reset:password` carried an explicit rationale: "an endpoint
that mints accounts and grants access roles is an account-creation-and-privilege-
granting endpoint reachable from the internet. Keeping it in a CLI means the
running application cannot create accounts, no matter what it is tricked into
doing."

That is a real property and it was given up knowingly. What it cost was found by
using the product: creating a Person under Manage → People creates no way for
that person to sign in — Person and Account are different things (TAXONOMY.md §2
vs §4) — and both CLIs then refused the follow-up. `create:account` answered
"A Person with email X already exists in tenant Y. This script creates; it does
not update. Use reset:password or grant:permissions" — and `reset:password`
answered "No account with email X." So the two tools each named the other, and
neither could finish the job. Nothing in the product could, either.

The three options were: leave it (a documented dead end reachable from the
ordinary path), fix only the CLIs (correct, but every login still needs shell
access to the database host), or expose it. Exposed, at the user's explicit
request, and BOTH CLI gaps fixed as well — they remain the only path that works
before a tenant has anybody who can sign in.

## What replaced the protection, since something had to

The old stance's value was "the running application cannot mint a credential."
That is gone. Four narrower properties were put in its place, and the negative
cases in `tests/account-api.test.ts` are what separate this build from one where
they are decoration:

1. **Visibility is the join.** `account` has no `tenant_id` and no RLS, so there
   is no policy to lean on. `accountScope()` is the only place "this tenant's
   login" is defined, and the list query starts from `person` — RLS-scoped — so
   the boundary is a property of the query rather than a WHERE clause each
   handler has to remember. Cross-tenant ids are 404.

2. **Sole-tenant ownership of the credential.** The genuinely new attack this
   feature creates: one Account may act in several tenants, so tenant A's admin
   resetting its password can then sign in and select tenant B's identity —
   cross-tenant account takeover through a feature that looks like ordinary
   administration. `assertSoleTenant` refuses password, email, activation and
   deletion whenever `otherTenantCount > 0`. Signing out is allowed anyway,
   because it is fully recoverable by the holder and refusing it would remove the
   one immediate response to a stolen laptop from the tenant most likely to hear
   about it.

3. **Orphans are unrepresentable, not warned about.** An Account with no
   `account_person` row is invisible to every tenant — unlistable, unresettable,
   undeletable — while its password still works. So creation requires a
   `personId`, `assertDetachable` refuses to remove the last identity, and
   `persons.beforeDelete` refuses to delete a Person holding a login (the FK is
   ON DELETE CASCADE, so the database would have accepted it happily). The two
   assertions are exact complements: sole tenant → delete allowed, detach
   refused; shared → detach allowed, credential ops refused. Neither needs an
   escape hatch, which is why neither has one.

4. **Two permissions, not four CRUD verbs**, mirroring `access_role`: what a
   tenant decides is "may audit the logins" versus "may mint and reset them", and
   there is no coherent middle where somebody may create an Account but not reset
   its password. Folding creation into `person.create` was rejected outright — it
   would have promoted every roster editor in every existing tenant into someone
   who can hand out credentials, silently.

## Two traps this hit, both the codebase's own recurring shapes

**`otherTenantCount` computed inside the tenant transaction.** The obvious
implementation — `account.persons.person.tenantId`, a nested Prisma select — is
wrong in the worst available way: `person` is behind RLS, so the join returns only
the calling tenant's row, every account reports exactly one tenant, and BOTH
guards above pass for every shared login while looking correct. It has to go
through `calendry_internal.account_identities()`, the SECURITY DEFINER function
the auth plane already uses. The list route does it with a
`CROSS JOIN LATERAL` so one query serves a whole page. `tests/account-api.test.ts`
§ "counts the other institutions a shared login serves" is the assertion that
would catch a regression; without it the suite would pass against a build with no
isolation at all.

**The person select rendered empty server-side.** The candidates list is fetched
client-only (`server: false`) — this is a CHILD component and the page holds the
single top-level await, so fetching on the server without awaiting would render
the option list twice from two different states. Consequence: the edit page's
`<select>` server-rendered as "— Choose a person —", selected, for a login that
plainly has one, corrected a moment later on the client. Same family as the
SSR/watcher bugs and the `<select>`/`:selected` bug already recorded here, found
the same way — by a test asserting CONTENT ("Vic Viewer") rather than element
presence. Fixed by seeding the option list from the ROW, which is part of the
page's own awaited data, and unioning the client-fetched candidates onto it.

## Smaller calls, recorded so they are not re-litigated

- **`accounts` deliberately absent from `CRUD_RESOURCES`** while still declared in
  `RESOURCE_PERMISSIONS`. The generic routes' `where: { tenantId }` matches
  nothing against a table with no such column, and "nothing" reads as an empty
  institution rather than as a broken query. Bespoke handlers, shared gate
  declaration, so the client's permission prediction stays derived.
- **The section gate is `account.read` while the API's read also accepts
  `account.manage`** — the same deliberate divergence `access-roles` carries in
  the other direction (its section is `access_role.manage`-only while the API
  also accepts `person_access_role.assign`). A manage-only role can therefore use
  every endpoint but does not see the section; granting both is the intended
  composition, and provisioning grants the whole catalogue anyway.
- **The password is generated in the browser.** `shared/password.ts` holds the
  floor and the generator for both runtimes, because a form that accepts eleven
  characters over an API that refuses them puts the error on a field the user
  filled in correctly by the rule they were shown. Generating client-side is what
  lets the create page navigate to the detail page on success without losing the
  one moment the secret is legible.
- **`errorData` on `useEntityForm`.** The already-registered-email 409 carries
  `accountExists: true` so the form can offer to attach. Matching on the message
  text would have worked and would break the moment the wording changes; the flag
  is contract, the sentence is not.
- **Detach is `POST /accounts/:id/detach`, not `PATCH { personId: null }`.** The
  routes convention (explicit verbs for editing ops) plus one practical reason:
  the form's person select has a placeholder option, and clearing it must not be
  able to remove a tenant's access to a credential by accident. PATCH answers
  `personId: null` with a 422 that names the action instead of a zod type error.
- **`beforeDelete` added to `ResourceConfig`.** `afterWrite` already fires on
  delete and is useless here — the cascades have run by then, so a guard
  measuring the aftermath sees a consistent database and an unreachable Account.
  It reads through `person` rather than `account_person` directly: that table has
  no RLS, so the direct query would have turned a cross-tenant id from a flat 404
  into a 409 naming somebody else's login.
- **`create:account` reports "nothing to do" and exits 0** when the requested
  state already holds. Exiting non-zero would make an idempotent provisioning
  script look broken; still never an upsert, so no password, name or role is
  rewritten.
- **`reset:password --create` switches to the OWNER connection** and prints that
  it did. Finding a Person by email means reading `person`, which is behind RLS
  with no tenant context out here. The default path keeps the app role, for the
  reason that script always gave: an operator should not need credentials that can
  drop FORCE ROW LEVEL SECURITY just to change a password. It also refuses to pick
  when an address is on several rosters, and warns loudly when the person holds no
  AccessRole — a login that signs in and sees nothing is the most confusing
  possible outcome, and granting is tenant configuration, not password recovery.

## Accounts: the login plane, which a tenant only half-owns

`/manage/accounts` ("Logins") issues credentials over HTTP. This REVERSES the
earlier "only a CLI may mint accounts" stance — deliberately, on request, because
creating a Person creates no way to sign in and the CLIs answered an existing
Person with "already exists" and stopped. Reasoning and what replaced the old
protection: § "Accounts in the management area".

- **`accounts` is NOT in `CRUD_RESOURCES` and never will be.** `account` carries
  no `tenant_id` and no RLS (exception 2), so the generic routes'
  `where: { tenantId }` matches NOTHING — not everything, nothing, which reads as
  an empty institution rather than a broken query. Own handlers under
  `server/api/accounts/`; the gate is still declared in `RESOURCE_PERMISSIONS`
  (`account.read` / `account.manage`) so the UI can predict it.
- **Visibility IS the join**, and it substitutes for RLS: an Account is this
  tenant's iff `account_person` links it to a Person here. Written once, in
  `accountScope()`; the list query starts from `person` (RLS-scoped) rather than
  from `account`. A cross-tenant id is 404, never 403.
- **A tenant may change a credential only while it is the credential's ONLY
  tenant** (`assertSoleTenant`). Password, email, activation, deletion all behave
  identically in every institution an Account serves, so permitting them on a
  shared login would be cross-tenant account takeover wearing administration's
  clothes. Signing out is the one exception — fully recoverable by its holder.
- **The mirror rule makes an orphan unrepresentable** (`assertDetachable`):
  detaching the LAST identity would leave a working password no tenant can see or
  revoke. So: sole tenant → delete allowed, detach refused; shared → detach
  allowed, credential ops refused. Exact complements, no escape hatch. Creation
  therefore REQUIRES a `personId`, and `persons.beforeDelete` refuses to delete a
  Person who holds a login.
- **`otherTenantCount` must be computed through
  `calendry_internal.account_identities()`**, never a join to `person` — inside
  the tenant transaction that join sees one tenant, so the count would be 0 for
  everybody and both guards above would silently stop guarding.
- **An already-registered email is an OFFER, not a wall.** 409 carrying
  `accountExists: true` (a flag, so no client matches on wording), and
  `attachExisting: true` links that credential instead. `useEntityForm().errorData`
  exists for exactly this.
- **The password is generated in the BROWSER** (`shared/password.ts`, shared floor
  `PASSWORD_MIN_LENGTH`). The server generates one when none is sent, but the
  create page navigates away on success, so a server-generated secret would be
  gone before it could be read.
- **`--attach` (create:account) and `--create` (reset:password)** are the CLI
  halves of the same gap: reuse an existing Person / create a missing Account.
  `--create` switches reset:password to the OWNER connection because it has to
  read `person`, and says so on stdout. Neither ever upserts; `create:account`
  reports "nothing to do" and exits 0 when the state already holds.
- **A new permission needs the 4th deploy step.** `account.read`/`account.manage`
  are new — `bun run grant:permissions -- --role tenant-admin --all-missing --yes`
  on every existing tenant, or every tenant-admin 403s on a section they can see.

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

## The scaffold itself, in one page

`/manage/<entity>[/…]` is one scaffold: three route files render every
entity from `app/utils/manageRegistry.ts`, which is also the nav source —
sidebar, header, palette can't drift from each other or the entity list.
(`/manage` bare is a redirect to `/dashboard` as of 2026-09-01, below — the
separate index page these routes used to hand off to is gone.)

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
- **The create action lives on the LIST and the DETAIL screen**, from one
  registry entry (`canCreate && !hideCreateAction`). Creating navigates to the
  row it just made, so without the second copy a run of records costs two
  navigations each to reach a button that was on screen a moment earlier.
  `secondary` on the detail screen: Save is the primary action there.
- **The Ctrl+K palette holds no permission logic** — input is the
  already-filtered nav source.
- **Overlays claim the keyboard** via `useOverlay()`, following open
  *state* not the function that opened it.
- **Structural constraint types** (`RoomDoubleBooking` etc.) are
  tenant-toggleable at all three layers (app evaluator, solver input,
  solver's `convert.rs`) — not "always-on" despite some prose elsewhere
  claiming so.

The verification behind these — the `paramField()` divergence, the
invisible-deprecated-types bug, the ten-file `vartorgba` styling bug and the
read-only-path test — is the first half of this section.

## 2026-09-01 — `/manage`'s own hub page folded into `/dashboard`

Signing in used to be three hops from anything useful: `/dashboard` (a bare
"you're signed in" page) → `/manage` (a separate cards-grid hub, itself just
picking a section) → an entity page. The middle hop existed only because
`ManageShell` — the sidebar+header frame every `/manage/*` page already
used — had never been asked to back anything else.

`ManageShell` renamed to `CommonAppShell` (moved
`components/manage/` → `components/common/`, matching that folder's
`Common*` convention) and broadened in two ways: its `NAV_GROUPS` gained a
`Schedule` (`/schedule`, not just `/schedule/proposals`) and a `My settings`
group, and its section source moved from `useManageSections()` (manage
entities only) to a new `useAppSections()` — every reachable destination
except `home` and the `account` section. `/dashboard` now wraps
`CommonAppShell` directly, rendering the manage-entities overview cards
`/manage/index.vue` used to own (with that grid's own empty state, scoped to
"no management section," since the sidebar may still offer Schedule/My
settings even then) plus the session's own permission list and sign-out
actions in the shell's `actions` slot.

`/manage/index.vue` is now a one-line `redirect: '/dashboard'` stub — kept
rather than deleted so an old bookmark still lands somewhere real.
`middleware/manage.ts`'s denial redirect and the sidebar's own "Home" link
both point at `/dashboard` now instead. The header's separate `Manage` nav
entry was removed outright (not repointed) — once it went to the same place
`Home` already did, keeping both was two buttons for one destination; this
also deleted the `hasManageSection` hub-visibility filter in
`useNavEntries()`, which existed only to decide whether to show that entry.

No entity page changed behavior — every one of them already had its own
back-link pointed at its own list, never at `/manage` itself, which is what
made the rename a mechanical import swap across those eight files rather
than a redesign.

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

## The resource, and the one classifier

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
healthy — the measurement is above.

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

## The standing rule, and why the solver filter is reference-derived

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
nothing breaks (reference-derived).

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

# A federation-shared Session shares the row, not its participants

CLAUDE.md's exception 1 says `session` may be Federation- rather than
Tenant-owned, with RLS read widened to the federation. What it does not say, and
what was decided deliberately, is **how far that sharing goes**.

The Session ROW is shared. Its participant links — `session_group` and
`session_person` — stay **tenant-private**. So a member tenant sees that a shared
lecture occupies a shared hall at a given time, and does not see which of another
institution's cohorts or people are in it.

That is a **deliberate narrowing of TAXONOMY.md's literal wording**, which reads
as though the whole Session becomes federation-visible. Occupancy is what a
federation needs to coordinate; the roster is not, and widening it would make
cross-tenant attendance visible to every member as a side effect of sharing a
room. If a future change makes participants federation-visible, it needs its own
reasoning — it is not an oversight to tidy up.

Related: `ExternalOccupancy` — occupancy of federation-shared Rooms by other
tenants — is resolved through a parameterless `SECURITY DEFINER` function, not a
cross-tenant ledger, for the same reason the auth plane is.

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

## What replaced the old booleans

Replaced `MinimizeFirstBlock`/`MinimizeLastBlock` (booleans baked to fixed
`SlotFlags` positions, silently wrong when a TimeGrid's day extends) with
`{ blocks: number[], first: bool, last: bool }` — `calendry-proto@0.4.0`.
Old fields kept `deprecated` not removed (`buf breaking` forbids removal;
existing tenant rows still need to render/edit, `type` is `createOnly`).

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

# Per-person preferences: stages 5–7, and three false negatives on the way

The feature and its verification are on the board. What is kept here is the three
traps, because **all three produced a result that looked like a clean answer** —
and none of them is specific to this feature.

**1. `buildVariant`'s `default: return {}` is only safe for a message with NO
FIELDS AT ALL**, which is not the same as a message this app sends no values for.
ts-proto iterates a repeated field without a presence check, so `{}` threw
`message.roles is not iterable` inside `hashInput` — before any request was made,
so the symptom was the whole `SolverInput` assembly failing rather than one
constraint misbehaving. Probed all sixteen variants rather than fixing the one:
`MaxOnlineShare`, `MinimizeBlockUsage`, `MinimizeDayUsage`, `MinimizeRoomRank` and
`PersonPreferenceFit` all crash on `{}`; the first four already had explicit
cases, and `PersonPreferenceFit` was the only one that could ever reach the
default. `{ roles: [] }` is load-bearing in two unrelated directions: the only
value that encodes, and the only value the solver accepts.

**2. An objective TOTAL cannot distinguish "term absent" from "term satisfied."**
A run reported `objective=118.5` with the rule off and on — identical, which reads
exactly like a term that was never added. It had been added and driven to zero.
Read the per-constraint `ObjectiveBreakdown` component, and confirm with a variant
that is unsatisfiable by construction.

**3. A `time_budget` run is not evidence.** Rule-off and rule-on produced
identical placements because the search never got far enough to differ — the
signature of a feature that does not work. Only `move_budget` and `converged`
terminations are reproducible; raise the wall clock until the move budget binds
before comparing anything.

A fourth, smaller one worth the line: the stage-6 script solved an **empty Term**
(a new term with 0 offerings sorted first) and reported "the rule doesn't fire".
A verification script must pick its subject deliberately and abort on an empty
one.

*(The design record `per-person-preferences-design.md` was deleted with the other
staging artefacts; the decisions it held are in the board card and in ADR-0026.)*

---

# Constraint `params` at the write boundary

**Closed 2026-08-28**, the last of three gaps in one family: the rule builder
honoured a rule and the generic CRUD API did not. The four failure modes are on
the board card; what belongs here is why the validation is shaped the way it is.

**Driven by the catalogue, not by a list.** Validation reads each parameter's own
`ConstraintParamDef` (`type`, `min`, `max`, `options`), so a parameter is
validated the moment it is declared and there is no second list to drift. Same
reasoning as `wireField` being data rather than a switch in the mapper.

**Two things it deliberately does NOT check**, and both are the difference
between closing a gap and breaking the screen that repairs one:

- **Not requiredness.** `missingConstraintParams()` asks that at SOLVE time, where
  the answer is one skipped rule with a stated reason rather than a refused save.
  A rule someone is still configuring must stay saveable, and two copies could
  disagree about what "set" means — an empty weekday list already differs.
- **Not unknown keys.** The builder spreads the stored object on every edit, so a
  key left by a retired parameter travels with the row; refusing it would make
  exactly the legacy rows that need repairing unrepairable. A stale key is inert.
  A *mistyped* key is not silent either: every parameter the mapper reads unsafely
  is `required`, so `missingConstraintParams` names it and skips the rule.

**Issues are blamed on the PARAMETER's key, never on `params`.** `params` is a
registered `custom` field the builder renders as many controls and never shows an
error for, so `path: ['params']` sets `fieldErrors.params` on nothing and
`applyError` skips its orphan banner — a failed save with nothing marked, the
least diagnosable outcome a form has.

---

# `PersonPreferenceFit.roles`: lecturers only, and what widening would cost

**Decided 2026-08-28. The field stays; the value stays empty** — an answer, not a
deferral. A `PersonPreferenceFit` term prices the preferences of a placement's
**lecturers** and of nobody else. On the wire that is `roles: []` — empty,
present, and the only value the solver accepts (`PreferenceRolesUnsupported`,
solver ADR-0026).

**Why not simply widen it.** A Session's attendee set is the **whole descendant
closure** of every attached Group. So "attendees" for a first-year lecture is not
a handful of people, it is the cohort: two hundred students, each contributing a
preference the solver would average alongside the one person whose Tuesday it
actually is. Whatever the aggregation, the teacher's preference becomes noise at
the third decimal. The rule would still run, still report a cost, and still steer
— just not toward anything anybody asked for.

**The bar a widening must clear**, so a future attempt starts from it:

1. **A per-role normalisation rule, decided before any code.** Not a weight per
   role, which merely re-scales the same broken aggregate — a rule that fixes what
   one role's preference is worth relative to another's *independently of how many
   people hold it*.
2. **A redefinition of the charge.** The solver charges the *mean over a
   placement's counted lecturers* of `multiplier × unmet`. A mean over a mixed
   role set is a different function, and the `hard_penalty` bound and
   `ruin_worst`'s ordering both depend on the current one.
3. **A disclosure decision.** Two hundred students' stated availability is a
   different disclosure from a lecturer's.

None is schema-blocked, which is the point of leaving the field in place.

**The trap:** `roles: []` is empty *and present*. `{}` — the value every other
parameterless variant returns — throws during encoding and takes the whole
assembly with it. Held by `tests/constraint-catalogue.test.ts`, which asserts the
variant equals `{ roles: [] }` exactly.

---

# Schedule display standards

`tenant_display_settings` is a **singleton keyed by `tenant_id`** — no surrogate
`id`, so a second row per tenant is unrepresentable rather than constrained. An
**absent row means defaults** (`DISPLAY_DEFAULTS` in `shared/sessionColor.ts`);
provisioning deliberately does not seed one, so "never configured" and
"configured, unchanged" render identically.

**The gates are `tenant.read` / `tenant.update`, and the READ is deliberately
wider than the page.** `GET /api/display-settings` accepts `tenant.read` **OR**
`session.read`, because it has two callers with different purposes: the settings
page, and the schedule's own colour resolution, whose fetch is TOLERANT. Narrow
it to `tenant.read` and nobody is denied a page — every lecturer's timetable just
draws in default colours with nothing on screen to say why. The PAGE and the nav
entry are `tenant.read` alone. Both keys moved off
`session.read`/`session_kind.update`, which had put an institution's own settings
in the navigation of everyone who could see a timetable: §
"`tenant.read` and `generation.read`".

**Colour is RESOLVED, never read off one field.** `resolveSessionColor()` walks
the tenant's `colorSourceOrder` (default `offering` → `kind`) and returns
**null** when nothing supplies one — never a fallback accent. The chip previously
read `kind?.color ?? primary500`, so every session without a kind colour claimed
the colour reserved for "where a session may land". `null` at any level means
INHERIT, which is why every colour column is nullable.

**Online delivery stays a virtual Room** (TAXONOMY.md). `isOnlineSession()` asks
the rooms; the setting decides only whether that is drawn. Marked with a dashed
edge, so it survives greyscale and an unset colour — same rule as violations.

---

# Grid geometry: minute-true, and rows grow

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

---

# The schedule toolbar: its height is invariant, and that is load-bearing

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

---

# TimeGrid breaks

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
deliberately — the board card is `OPEN QUESTION — a Session whose duration
spans a break`. One branch
would overturn "breaks never cross the wire."

---

# Group availability windows

Shipped; the verification is on the board. Two things here must not be undone.

**`group_term_availability` is the OPPOSITE table from `group_term`, and merging
them is the trap.** `group_term` is a **visibility scope** — row existence means
"only these Terms", and an unlinked Group is visible in every Term (fail-open).
Adding availability dates there is the obvious move and would silently scope the
Group **out of every other Term**. Absent row in `group_term_availability` =
available for the whole Term.

**Stored POSITIVE, sent NEGATIVE.** `blackedOutWeeks()` is the only place the
polarity flips, and week granularity rounds toward AVAILABLE — a partially covered
week counts as available, because the alternative removes teaching time nobody
asked to remove.

**Blackouts inherit DOWNWARD, so the query walks UP.** A Session attached to group
`g` is blocked by the windows of `{g} ∪ ancestors(g)`. That needed a **third**
closure table in the solver, `expand_ancestry` — neither of the existing two:
`subtree` points the wrong way and `conflict` contains it plus every descendant,
so both would let one seminar's absence veto the lecture its whole cohort attends.
All three agree on a flat hierarchy, which is why the guard is a two-level
fixture: `expand_conflict` fails exactly ONE of the eight tests in
`group_veto.rs`, `expand_subtree` fails four. Solver ADR-0027.

---

# A Session that spans a break: legal, drawn honestly, not sent to the solver

**Decided 2026-08-28.** A multi-block Session spanning a break is LEGAL, the app
must not draw it as contiguous teaching, and **breaks still never cross the wire**.
The measurements and the shipped fix are on the board; what must not be undone is
here.

**Do not "fix" this by adding a break field to the proto.** Three reasons, and the
first is the one that reads as settled and is not:

`toWireTimeGrid`'s comment says a gap "changes no adjacency" — sound for a
single-block Session, **false for a multi-block one**, whose contiguity is a claim
about the clock. A correct conclusion resting on a wrong reason is more dangerous
than a wrong one, because it stops the reader thinking. The conclusion survives
for different reasons:

- **No mechanism.** `Offering` has no `veto_slots` on the wire; the solver derives
  veto masks from constraints and per-Person/Group `Unavailability`, none of which
  can say "do not START a two-block Session at block 3".
- **Not universal.** A three-hour lab through a 15-minute coffee break is
  ordinary; a lecture through a 45-minute lunch is not. Deciding it globally would
  be a tenant-open judgement dressed as a schema fact.
- **Unpreventable anyway.** Manual edits produce it by design — hard-constraint
  violations from manual edits warn rather than block. A rule the solver honoured
  and one drag could bypass would still need the honest rendering, so the
  rendering was the load-bearing fix all along.

If a tenant genuinely needs the solver to avoid these placements, that is a
constraint with its own recorded decision reversing this section — not a schema
change made in passing because the gap looked like missing data.

**`gapsWithinSpan()` is the single definition** of what a span occupies but does
not teach, beside `gapAfter`/`breakAfter`. It counts the unnamed default gap as
well as named breaks, because both occupy real time. Note the grid shape that
makes this the normal case rather than an edge case: with `breakMinutes > 0`
*every* pair of consecutive blocks is separated, so every multi-block Session
spans a gap.

---

# Solver & proto: operational detail

The four things CLAUDE.md delegates here — installing the proto package, the
operator CLIs, the test accounts, and constraint-shape validation at the write
boundary — plus the leftovers that have no better home.

**This section used to restate ten other sections.** It was the condensed
CLAUDE.md rule list, moved here wholesale in the 2026-08-27 consolidation, and it
summarised determinism, warn-and-allow, Stage 2, Stage 4 polling, the virtual-room
bug, `violations.ts`, per-person preferences, `roles` and `MinimizeRoomRank` —
each of which has its own full section in this file, and each summary ended by
pointing at it. Two copies of a claim in one file is the drift hazard this file's
own preamble warns about, pointing inward. The summaries are gone; the sections
they pointed at are unchanged and are the only copy.

## Installing the proto package — three causes of one opaque 401

Credential lives in `~/.bunfig.toml` or a gitignored `./bunfig.toml`, never
committed; `bun run check:registry-auth` diagnoses it offline. Three independent
things produce the *same* uninformative 401:

1. A bunfig scope token needs that scope entry's own `url`.
2. An `.npmrc` auth line **overrides** a bunfig token.
3. GitHub Packages requires a **classic** PAT (`ghp_`) and rejects fine-grained
   ones.

Scope entries resolve nearest-first and are taken wholesale, not merged — so a
partial nearer entry silently shadows a complete farther one.

## Operator CLIs

`create:account` / `create:role`, for a tenant that already exists:

    bun run create:account -- --tenant test --email x@y.edu --name "…" [--role tenant-admin]
    bun run create:role -- --tenant test --key viewer --name "…" --permissions a.read,b.read [--dry-run]

Owner connection, audited to stdout. An existing email is **reused, not
duplicated**; duplicates fail loudly rather than being upserted; and there is
deliberately **no `--all`** for `create:role` — a role is composed from audited
grants, not minted as an unaudited superuser. Why these exist at all:
§ "Accounts & roles".

## Test accounts

- `verify@calendry.local` — HTTP verification, password in `.env` as
  `VERIFY_ACCOUNT_PASSWORD`.
- `vic@demo.local`, `viewer6b@calendry.local`, `cviewer@calendry.local` — hold
  `viewer` (six reads, no `solver.trigger` / `generation.apply`). Use these to
  assert an affordance is **absent** — and in the same test assert the page
  actually rendered, or "hidden" and "blank" are the same result.

A rebuilt dev database has one role and one account; recreate the rest with one
`create:role` + `create:account` each.

## Constraint shape at the write boundary

Severity (must match the catalogue's HARD/SOFT), weight (`>= 0`, no ceiling) and
`params` are all enforced by `validateConstraintShape()` on CREATE and UPDATE.
`beforeUpdate` validates only the fields being touched, deliberately —
merged-row validation would make an existing bad row permanently uneditable. A
DB CHECK backs the weight floor. Why the weight floor is not cosmetic: a negative
weight erodes `hard_penalty`'s margin for every rule in the tenant, not just the
mistyped one.

`params` was closed the same way on 2026-08-28, driven by each parameter's own
`ConstraintParamDef` so the catalogue's declaration is the rule and there is no
second list to drift. Requiredness and unknown keys stay OUT of it on purpose:
§ "Constraint `params` at the write boundary".

## AccessRole management (Step 14) is built

`RESOURCES['access-roles']`, `RELATIONS['persons/access-roles']`,
`ManageAccessRoleForm`. The grants are `childKeys`, **not** a relation: there is
no `/api/permissions` and must not be, because the editor renders from
`shared/permissions.ts` — so an unseeded permission is REPORTED rather than
silently missing from a list that looks complete.

## Auth leftovers

`must_change_password` is built: the operator `reset:password` revokes sessions,
sets the flag and audits; login blocks until `POST /api/auth/change-password`.
Federation-level permissions are out of scope (TAXONOMY.md §9.4).

Session cleanup is done — `server/plugins/sessionSweeper.ts`, **a Nitro plugin,
not a util**. That path was recorded as `server/utils/` until 2026-08-28, where
no such file exists. It deletes `auth_session` rows past 30 days, and needs
neither an RLS exception (there is none) nor claim machinery (the DELETE is
idempotent).

## Two numbers in this file that disagree with CLAUDE.md

Recorded rather than quietly reconciled, because picking one would invent a
measurement:

- **Throughput.** This section said a 27,000-Session instance solves in
  **~349 ms**; CLAUDE.md says **~250 ms**. Both are undated, neither has been
  re-measured, and the solver has changed twice since (PersonPreferenceFit,
  GroupVeto). Re-measure before quoting either.
- **Constraint count.** This section said "14 constraint types". The app
  catalogue now holds **15 live** types (`defaultConstraintTypes().length`,
  verified 2026-08-28), and the solver's own `ConstraintType` enum holds 10 —
  it enumerates only the reporting/hard kinds, with the `Minimize*` family
  carried as objective terms instead. The two were never counting the same
  thing, which is why the single number was wrong in both directions.

---

# Screens: a lobby display is a device, not a person

The build is on the board. What belongs here is the decision that was NOT taken,
and one lesson about how it was verified.

**It is not a fourth RLS exception, and the reason generalises.** The obvious
build — a public unauthenticated read — needs RLS dropped or a policy answering
with no tenant context. That was unnecessary, because exception 2 (the pre-tenant
auth plane) is not "auth is special"; it is a general **technique**: resolve a
credential by the unique hash of a secret it presents, never by a tenant filter,
through a `SECURITY DEFINER` function taking the secret alone. `screen_identity()`
mirrors `session_identity()` line for line, and everything after it is an ordinary
`withTenant()` transaction. **That technique is the part that generalises; the
device model is not** — a student without a credential is a different problem.

**A non-account principal holds no permissions and cannot acquire any.**
`heldPermissions()` throws 403 when `actorPersonId` is null — a guard written for
accounts that had not chosen a tenant, which happens to refuse a screen key
against every check in the app, including ones written years from now by somebody
who has never heard of screens. Never give a non-account principal an
`actorPersonId` to make a check pass.

**A revoked key proves nothing.** The first version of the isolation probe ran
after revocation and got 401 everywhere. That looks like a pass and demonstrates
nothing, because a revoked key is refused before any permission is consulted. The
probe only means something with a LIVE key, which returns 403 from the permission
layer rather than 401 from the resolver. Any future "this principal cannot reach
X" check has the same failure mode.

**Adding `kind` to `RequestIdentity` found a lie.** The background poller was
constructing an identity with `accountId: ''` and `sessionId: ''` — it has neither,
and the empty strings said something untrue about what was making the request.
Blast radius was nil, and that is the point worth keeping: `identity.accountId`
and `identity.sessionId` are read NOWHERE outside the type. Only `actorPersonId`,
`tenantId` and `federationId` are ever consulted.

**Key rotation is deliberately absent**, not forgotten. Rotating invalidates the
URL typed into a device on a wall, and the person clicking is rarely the person
who can walk to it. It belongs behind its own explicit action with its own
confirmation, never inside a PATCH that also renames things. Revoking
(`isActive: false`) is the recoverable half and is built.

---

# Two vatsim-radar attributions are deliberate

`modules/styles.ts` and `app/scss/variables.scss` carry attribution comments to
vatsim-radar. They are **provenance for borrowed code, not leftover branding**,
and survived the rebrand sweep on purpose. Do not remove them as stale template
text — that is exactly what they look like.

---

# The 100%-slot-occupancy schedule shape is intentional

Confirmed 2026-08-23 and re-recorded here when BACKLOG.md was retired. The demo
schedule packs Sessions into fully-occupied weeks — 18 of 18 slots for several
consecutive weeks — as a side effect of `minimize_day_usage`'s weight relative
to the other soft rules.

**Not a bug, and deliberately kept as-is.** It is written down only because the
shape looks alarming: a future session finding it will otherwise spend time
deciding whether it was intended. It was.

---

