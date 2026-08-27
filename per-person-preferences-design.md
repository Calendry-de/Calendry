# Per-person soft preferences — design record

Working draft. Companion to `CLAUDE.md` (this repo and `calendry-solver`),
`TAXONOMY.md` and `BACKLOG.md`. Decisions with reasoning; open questions left
open on purpose.

**Status: stages 1–4 built; 5–7 open.** Sections 1–3 record decisions that are
already *shipped* (see §0). **All five open questions were decided on
2026-08-26.** Stage 4 was built on 2026-08-27 — the app now assembles and sends
`Person.preferred` and reports whether the rule has anything to work with.

**What remains is not app work.** Stage 5 is the solver's evaluator and belongs
in `calendry-solver`, per this repo's standing rule that solver logic is not
authored here; stage 6 proves it fires; stage 7 removes the disclaimers and is
gated on 6. Until stage 5 lands the constraint deliberately does not cross the
wire at all — see "Where `wireField` gets flipped".

One decision changed a conclusion this document had previously reached: §4's
bounded per-person override makes the flat refusal of "per-person weights"
obsolete, and §5's wire sketch had to change with it. Both are marked where they
occur rather than silently rewritten.

---

## 0. Two premises this pass had to correct first

### 0.1 This is not unimplemented

`BACKLOG.md` § "Larger features — needs a full design pass" says of every item
in that section, this one included, that "none of these have any implementation
yet". For per-person preferences that is **false**, and has been for some time.
What exists today, verified against the code rather than the entry:

| Piece | State | Where |
|---|---|---|
| Storage | **built** | `PersonPreference` model, table `person_preference` |
| Self-service write | **built** | `PUT /api/me/preferences`, gated `availability.manage_own` |
| Staff write on behalf | **built** | `PUT /api/availability/preferences/[personId]` |
| Staff read across tenant | **built** | `GET /api/availability/preferences` |
| Validation against the grid | **built** | both write paths reject `block >= blocksPerDay` |
| Shared types + labels | **built** | `shared/availability.ts`, `app/utils/availabilityLabels.ts` |
| Self-service UI | **built** | `app/pages/my/preferences.vue` |
| Staff UI | **built** | `app/pages/manage/availability/preferences.vue` |
| Constraint catalogue entry | **built** (stage 2) | `person_preference_fit`, SOFT, off by default, `wireField` deliberately unset so it SKIPS |
| Weight override column | **built** (stage 2) | `person_preference.weight_multiplier`, clamped `[0.5, 2.0]` by zod, a CHECK, and the staff UI |
| Wire field | **on the wire, NOT populated** | `Person.preferred` (5), `Preference`, `PersonPreferenceFit` (27) exist as of proto `v0.7.0`. `assembleSolverInput` does not write them — that is stage 4 |
| Solver evaluator | **compiles, explicitly REFUSES** | `convert.rs` returns `Status::unimplemented` for `PersonPreferenceFit`. Not a no-op: the exhaustive match made a silent omission impossible, so the branch is a deliberate refusal, matching `LockPolicy::MINIMIZE_MOVEMENT`. A real evaluator is stage 5 |

So the remaining work was **exactly three artifacts**: a catalogue type, a proto
field, and a solver evaluator. Two of the three now exist — the catalogue entry
(stage 2) and the wire field (stage 3, proto `v0.7.0`) — leaving the evaluator,
plus the assembly step that populates the field. That was already a much
narrower problem than the backlog entry described, and it was scoped by the
schema's own comment on `PersonPreference`:

> STORED BUT NOT YET SOLVER-EFFECTIVE. Nothing reads this into `SolverInput`,
> because the wire has no field for it: `Person.preferred_days` /
> `preferred_blocks` and the `person_preference_fit` constraint type are a
> deliberately separate later slice that touches calendry-proto and the solver.

**This is the drift `CLAUDE.md` warns about** ("a tracked-gap entry written from
design INTENT can drift from the code silently"). The entry was accurate when
written and is now describing a gap that closed. Corrected by pointing the
backlog entry at this file.

### 0.2 Person-level self-service already exists

The prompt for this pass framed §3 as "who sets it, given self-service doesn't
exist yet", and told me not to assume self-service is coming next. It is not
coming — **it is here.** `availability.manage_own` is a real permission in the
catalogue, `/my/preferences` is a real page behind it, and the `/my` section has
its own middleware and header entry. The separate BACKLOG item "Person-level
self-service access model" describes a *general* row-level self-scoping model
that indeed does not exist; what shipped is a narrower thing — a hand-built
`/me/*` surface that only ever reads and writes the caller's own row. §3 records
what that means for this feature.

### 0.3 Notes on the source documents

- `taxonomy-and-architecture-decisions.md` and `solver-architecture-decisions.md`
  do not exist in this repo. The equivalent content is in `TAXONOMY.md`,
  `CLAUDE.md` (this repo) and `vendor/calendry-solver/CLAUDE.md`. This file is
  written in that style.
- The day-mix precedent is real and is quoted accurately below:
  `Objective.day_mix_cost` is a distinct `f64` field in
  `crates/core/src/soft.rs`. Note that it does **not** correspond to a proto
  field — the weight crosses the wire as `OnlineOnsiteSameDay`'s ordinary
  `weight`, and `day_mix_cost` is purely a solver-internal accounting split.

---

## 1. Data shape

**DECIDED, and shipped: a separate `person_preference` table, keyed by
`person_id` as its primary key.**

Recording why, because the alternative (columns on `Person`) is the obvious
first instinct and the reasoning is not obvious:

- **`personId` is the primary key**, so "at most one preference row per Person"
  is true by construction rather than by a unique index someone could drop. The
  schema comment says exactly this.
- **An absent row means "no preferences", and the write path deletes the row
  when both arrays end up empty.** That gives the empty state exactly one
  representation. Columns on `Person` would give it two — `NULL` and `{}` —
  rendering identically and comparing differently, which is the class of bug
  this codebase keeps finding (`[]` is truthy; `active?.[0]`).
- It carries its own `tenant_id` for RLS, and cascades from both `tenant` and
  `person`.

### DECIDED: widen the row. A second kind is coming, and it is grid-shaped

A **room-type preference** ("prefers this room type") is expected next. By this
document's own criterion that fits Option (A) — widening `person_preference`
with another array column — and does **not** trigger the typed-rows/new-table
branch, which is reserved for preference kinds that are not grid-shaped.

The two directions, kept because the trigger between them is the useful part:

- **(A) Widen the row.** A new kind is another array column on the same table.
  Cheap, typed, queryable, every kind visible in one `SELECT`.
- **(B) Typed rows** — `person_preference(person_id, kind, values[])`. Adding a
  kind becomes data rather than DDL.

**The trigger that would force a move off (A):** a preference kind that is not a
*set over one axis* — a numeric target ("at most 3 teaching days a week"), a
pairwise rule ("not immediately after a lab"), or anything carrying its own
parameters. At that point (B) is not the answer either, because those want typed
fields rather than a generic value array; the right move is a new table for that
shape, the way `person_unavailability` and `person_preference` are already two
tables rather than one with a discriminator. (B) mainly buys the ability to store
preference kinds nothing can evaluate.

### The room-type kind: use the existing vocabulary, and mind one wrinkle

Checked rather than assumed: **there is no `Room.type` or `Room.kind` field.** A
Room carries `capacity`, `ranking`, and tags through `RoomEquipment` →
`Equipment`, a tenant- or federation-owned vocabulary of `key`/`name` rows. That
is the existing room-feature vocabulary, it is what already crosses the wire as
`Room.feature_tags`, and a room-type preference should reference it rather than
inventing a parallel list. (`Room.ranking` is the other candidate axis and is
already served by `MinimizeRoomRank` at tenant level.)

**The wrinkle, which the day/block axes do not have:** those store small
integers that mean something on their own — ISO weekday 2, block index 0. A
room-type preference stores a *reference to another entity*, and a Postgres
array cannot carry a foreign key. Two honest forms:

- **`preferredRoomFeatures Text[]`, holding `Equipment.key`.** Matches what the
  wire already sends (`feature_tags` is a string list), survives an Equipment
  row being re-keyed only if someone updates both, and has no referential
  integrity — a deleted Equipment leaves a stale string that is inert rather
  than wrong.
- **A small join table `person_preferred_equipment(person_id, equipment_id)`.**
  Real FK integrity and cascade behaviour; still one preference *kind*, so this
  is not the (B) branch — it is (A) with a link table instead of a column.

**Recommendation: the join table**, because `Equipment` is a real entity with a
lifecycle and every other reference to it in this schema is an FK. The
text-array form is defensible only if the preference is meant to be tolerant of
vocabulary that does not exist yet. Either way this is a *stage 1 decision for
the room-type kind*, not for the day/block kind being designed here.

`Role`/`AccessRole`-style caution applies: preference *kinds* are fixed
vocabulary (code, like the permission catalogue and the constraint catalogue),
never tenant-invented, because a kind with no evaluator is meaningless. This
mirrors `CLAUDE.md`'s "Permissions are fixed, roles are not".

---

## 2. Representation

**DECIDED for storage, and shipped: two independent integer arrays** —
`preferredDays` (ISO weekday, 1 = Monday) and `preferredBlocks` (0-based block
index within the day). Empty means **no preference**.

Two properties of that choice which are already load-bearing:

1. **Emptiness is INVERTED relative to `person_unavailability`**, where an empty
   array means "every value on that axis" (`{days:[5]}` = every Friday). Both
   models say so in their own comments. The consequence for §5 is direct: the
   wire must **not** reuse the `Unavailability` message for preferences, however
   structurally identical the two look.
2. **No week axis.** `person_unavailability` has `weeks` plus a `termId`;
   `person_preference` deliberately has neither. A preference is a recurring
   weekly shape, not a dated absence. §6 depends on this more than anything else
   in this document.

### DECIDED: additive / independent partial credit

The stored data cannot distinguish these three readings of
`{preferredDays: [2], preferredBlocks: [0, 1]}`:

- **(A) Additive / independent partial credit.** Tuesday earns credit; blocks 0
  and 1 earn credit; a Tuesday first block earns both. "I like Tuesdays, and I
  like mornings" — two separate statements.
- **(B) Conjunction.** Only Tuesday-morning placements satisfy it. "I like
  Tuesday mornings" — one statement about a cell.
- **(C) Disjunction.** Tuesday *or* morning satisfies it fully; both is no
  better than either.

| | Expressiveness | Cost model | Data change needed |
|---|---|---|---|
| A | cannot say "Tuesday morning only" | monotone, decomposable, O(1) delta | none |
| B | cannot say "Tuesdays, and separately mornings" | still O(1), but needs a (day × block) mask | **yes** — a matrix, not two arrays |
| C | same limitation as B, plus a flat cliff | O(1) | none |

**DECIDED: (A), additive.** It is what the shipped data actually encodes, it is
the only one of the three that composes cleanly when a person states two
unrelated things, and it keeps the per-placement cost a sum of independent terms
— which is what §6's precomputation and §4's bound both rely on. (B) is strictly
more expressive for one specific sentence and would require changing the table,
both write paths, both UIs and the wire; if a tenant genuinely needs "Tuesday
mornings only", that is a second preference kind under §1, not a
reinterpretation of this one.

**Stage-1 follow-up, and it is the one piece of this decision that lives outside
this file:** the `PersonPreference` schema comment currently states the
inverted-emptiness convention but says *nothing* about how the two axes combine.
Write "additive: each axis earns credit independently; a Tuesday first block
earns both" into that comment when stage 1 touches a migration. Until then the
first evaluator to read the table would fix the semantics by accident, which is
the whole reason this question was open.

### Not a bitmask

The prompt suggested mirroring the hard veto's "bitmask over (week, timeslot)".
Preferences should **not** adopt that representation on the app side:
`person_unavailability` stores `days`/`blocks`/`weeks` as integer arrays too —
the bitmask is a *solver-internal* representation built at conversion time, not
a storage or wire shape. Keeping storage as small integer arrays is what lets
the write paths validate against `blocksPerDay` and the UI render "Tuesday,
Thursday · blocks 1–2" without decoding anything.

---

## 3. Who sets it

**DECIDED, and shipped: both, with no approval workflow.**

- **Self-service:** `PUT /api/me/preferences`, `availability.manage_own`. Reads
  and writes only the caller's own row.
- **Staff on behalf:** `PUT /api/availability/preferences/[personId]`, plus a
  tenant-wide read for the review surface.

The interesting decision is the one that is *absent*: **preferences have no
PENDING/APPROVED state machine, and unavailability does.** That asymmetry is
load-bearing and should not be "fixed" into symmetry later:

> A veto is a HARD constraint: an unreviewed one can make a term infeasible, so
> approval exists to stop unilateral tightening.

A preference is SOFT. The worst a person can do by declaring one is shift a
weighted term in the objective — it cannot make a term infeasible, cannot
refuse a placement, and cannot be used to seize a slot. There is nothing for an
approver to protect, so an approval queue would be pure ceremony. This is the
same warn-and-allow reasoning as §3 of `TAXONOMY.md`, applied one level up: the
system permits the input and prices it.

**If the general self-scoping model never lands**, nothing here changes. The
`/me/*` surface is hand-built and complete for this feature; the general model
would let it be expressed declaratively instead of by hand. That is a
refactoring opportunity, not a prerequisite.

**Staging does not affect §1.** The table needs no `entered_by` column: the row
is per-person state, not an event, and unlike `person_unavailability` — which
carries `created_by_person_id` precisely because a submitted veto is an
auditable act with a decision attached — a preference has no decision and no
adversarial reading. If provenance is ever wanted, the honest place for it is
the event log, not a column here.

---

## 4. Weight semantics

**DECIDED: a tenant-wide default weight, overridable per person by management,
with the override clamped to a multiplier in `[0.5, 2.0]`.**

This is neither of the two options this document originally presented as the
realistic choices, and it **revises the flat refusal of per-person weights**
recorded in the first draft. That refusal was correct about *unbounded* per-row
weights and wrong to generalise: what made Option B dangerous was not
per-person-ness, it was unboundedness. The reasoning is worth keeping in full,
because the safety argument is the whole design.

### The precedent this still follows

`lecturer_veto` is already "a tenant-level policy switch over per-person data":
`params: []`, severity HARD, evaluator `solver` — the blackout *values* live on
the Person, and the constraint row only decides whether the tenant enforces them
at all. `person_preference_fit` keeps that architecture, one severity down. The
tenant weight answers "how much does this institution care about honouring
stated preferences, relative to its other soft goals"; the per-person override
answers "and this particular lecturer's case is unusual".

### The three options as they were weighed

- **(A) One tenant-wide weight.** Simple, computable, and cannot express "the
  department head's preference outranks a first-year tutor's" — a real
  institutional fact that a scheduling tool refusing to model does not make go
  away.
- **(B) An unbounded per-person weight column.** **Refused, and still refused.**
  It moves a safety property into a table any tenant can edit: `hard_penalty`
  would become a function of instance *data* rather than of the constraint
  configuration, and an unbounded column there is `CLAUDE.md`'s negative-weight
  incident with a wider blast radius. It also hands tenants a fairness lever with
  no policy attached — "why is my preference 3 and hers 7" is a conversation the
  software would have created.
- **(C) Tenant default × a bounded per-person override.** **Chosen.** Keeps (A)'s
  computable ceiling while admitting the fact (A) cannot express.

### Why the clamp is a MULTIPLIER, not an absolute floor/ceiling

Both were on the table; the multiplier wins on two counts and the second is
decisive:

1. **It is explainable in one sentence.** "This person's preferences count half
   as much / twice as much as normal." An absolute override has to be explained
   relative to a tenant weight the admin may not have in front of them.
2. **It survives a change to the tenant default.** If a tenant raises the
   default weight from 5 to 20, every *absolute* override silently becomes a
   demotion — a row that used to mean "count this person double" now means
   "count them at a fifth". Keeping every override correct would require
   re-validating and rewriting them on each tenant-weight change, which is a
   data sweep dressed up as a config edit. A dimensionless multiplier is
   unaffected by construction.

`[0.5, 2.0]` is the proposed range. The exact numbers are a policy choice and
cheap to change; what matters is that a maximum exists and is small.

### Why this stays safe for `hard_penalty`

`hard_penalty = sum(all soft weights) × placements + 1` is load-bearing, not
cosmetic — see the negative-weight incident, and the `MinimizeRoomRank`
`severity()` cap normalised to `0.0..=1.0` so that a graded rule's maximum
contribution still equals its configured weight. This type has to fit inside
that discipline, and it does:

**Adopt the same `0.0..=1.0` normalisation per placement.** The preference fit of
one placement is expressed as a fraction — how much of the counted set's stated
preference this placement satisfies — so a placement's contribution is at most
`weight × max_multiplier × 1.0`. The whole type's contribution to the bound is
then `tenant_weight × 2.0`, a fixed number computable from the constraint
configuration alone, **independent of how many lecturers have an override on
file**.

That normalisation is doing real work, and it is worth being precise about why,
because a plausible-sounding shortcut is wrong. It is tempting to argue "at most
one person's weight applies to any single placement, so there is nothing to sum".
**That is false**: the wire carries `Offering.required_lecturer_count` alongside
`candidate_lecturer_ids`, so a placement can legitimately have several lecturers,
each potentially with their own multiplier. Without normalisation the
per-placement ceiling would be `weight × max_multiplier × max_lecturers ×
axes_matched`, which is computable but depends on instance data — exactly the
property (B) was refused for. Normalising to `0.0..=1.0` first removes that
dependency, which is what makes the bounded override safe rather than merely
bounded.

This is also where §§4.1 and 4.2 earn their keep: **lecturers-only** keeps the
counted set small and meaningful, and **raw per-placement accrual** keeps the
term placement-local so there is a per-placement ceiling to normalise at all. A
normalised-per-person variant (§4.2's alternative) would have no per-placement
quantity to bound.

### Mechanism — a data-shape note, not a migration

`person_preference` gains a nullable override column:

```
weightMultiplier  Decimal?  @map("weight_multiplier")   // NULL = use the tenant default
```

- **`NULL` means "use the tenant default"**, and is the only representation of
  that state — the same single-representation discipline that makes an absent
  row mean "no preferences". Note the interaction: the write path deletes the
  row when both preference arrays are empty, so a multiplier cannot outlive the
  preference it modifies. That is correct (a multiplier on nothing is nothing),
  but it must be deliberate rather than incidental, and the delete condition
  should say so.
- **Both write paths validate against the clamp at the boundary**, exactly as
  they already validate `block >= blocksPerDay` and return a field-named 400.
  This is the write-boundary pattern `CLAUDE.md` records for constraint
  severity/weight: the builder honouring a rule the generic API did not is how
  the negative-weight hole existed.
- **A database CHECK backs it up** (`weight_multiplier IS NULL OR
  (weight_multiplier >= 0.5 AND weight_multiplier <= 2.0)`), for the same reason
  `constraint_weight_non_negative` exists: `provision:tenant` and any future
  backfill write rows without passing through the resource schema.
- **Who may set it:** management only. The staff path
  (`PUT /api/availability/preferences/[personId]`) accepts it; the self-service
  path (`PUT /api/me/preferences`) must **not** — a person raising their own
  weight is precisely the unilateral escalation that §3 argues preferences are
  otherwise free of. This is the one place where the two write paths stop being
  the same operation with different subjects, and the asymmetry needs a test,
  not a comment.
- **Self-service cannot SEE it either, and that is intentional rather than a
  side effect of the shared type.** `GET /api/me/availability` selects only
  `preferredDays` and `preferredBlocks`, so the value never reaches
  `/my/preferences` — checked, not assumed. Showing someone a weight they cannot
  change would invite the argument the field exists to avoid having in public,
  and the read path is where that gets decided; `weightMultiplier` is optional on
  the shared `PersonPreferences` type precisely so the self-service page can keep
  using it without carrying the field.

  **Self-service cannot SEE it either, and that was confirmed as intentional
  rather than a side effect of the shared type.** `/api/me/availability` selects
  only `preferredDays` and `preferredBlocks`, so the value never reaches
  `/my/preferences` — checked in the handler, not inferred from the optional
  field on `PersonPreferences`. Showing someone a weight they cannot change
  invites a conversation the institution has no answer to ("why is mine 0.5"),
  and the number is a management judgement about competing constraints rather
  than a fact about the person. The staff page is where both halves live.

### 4.1 Whose preferences count — DECIDED: lecturers only

A Session's attendee set is lecturers plus every member of every attached
Group's descendant closure — averaging ~65 people at benchmark scale. Counting
every attendee turns "this tutor prefers mornings" into an unweighted popular
vote in which a 200-student cohort swamps the lecturer, and there is no
student-facing surface to enter such preferences anyway.

`Person.role_tags` already crosses the wire with `"lecturer"` as the one fixed
universal role, so no new data is needed. It is also by far the cheapest option:
lecturer sets are 1–2 people against ~65 attendees, which matters directly to
§6's precomputation.

**State it in the catalogue description**, so "my students' preferences are
ignored" reads as a documented scope rather than a bug. The two rejected
options — all attendees, and role-weighted with a per-role multiplier — stay
recorded here; role-weighting would reintroduce exactly the instance-data
dependence §4 just removed.

### 4.2 Accrual — DECIDED: raw, per placement

A lecturer with 20 sessions can accrue 20× the penalty of one with a single
session, so the solver will preferentially satisfy the busiest person's
preference. That is accepted, and arguably right: the person in the building
most has the most to gain. The alternative — normalising per person, "what
fraction of *my* sessions landed in my preferred window" — is fairer in the
abstract and **changes the shape of the term from placement-local to
aggregate**, which is the decision §6 turns on.

Raw accrual is what keeps three separate things simple, and they reinforce each
other rather than merely coexisting:

1. the O(1) exact delta (§6),
2. `ruin_worst`'s ability to see the term at all (§6),
3. the fixed per-placement ceiling that makes §4's bounded override safe.

Revisit only on a real complaint, and understand that revisiting means accepting
an aggregate term with all three of those properties lost.

## 5. Wire / proto shape

**Sketch only.** `buf`'s `FILE` breaking ruleset plus the additive-only
discipline in `calendry-proto` means all of this is a **minor version bump**
(`0.7.0`), never a renumbering.

### 5.1 On `Person` — field 5

`Person` currently uses fields 1–4 (`id`, `role_tags`, `group_ids`,
`blackouts`), so 5 is next.

```proto
message Person {
  string id = 1;
  repeated string role_tags = 2;
  repeated string group_ids = 3;
  repeated Unavailability blackouts = 4;

  // Soft. EMPTY MEANS NO PREFERENCE — the opposite of Unavailability above,
  // where an empty repeated field means "every value on that axis".
  Preference preferred = 5;
}

message Preference {
  repeated uint32 days   = 1;  // ISO weekday, 1 = Monday
  repeated uint32 blocks = 2;  // 0-based within day

  // §4's bounded per-person override, clamped by the app to [0.5, 2.0].
  // `optional` for real field presence: absent means "use the constraint's
  // weight unmodified". A plain double could not express that, because proto3's
  // zero default is itself a meaningful multiplier.
  optional double weight_multiplier = 3;
}
```

**THIS IS A CHANGE FROM THE FIRST DRAFT, and it contradicts the assumption that
the weight never crosses the wire.** That assumption was worth checking and does
not hold. The evidence:

- `toWireConstraint` emits **one** scalar per constraint row —
  `weight: type.severity === 'SOFT' ? (row.weight ?? 0) : 0`
  (`server/utils/solverInput.ts:213`), read from the row, and `ConstraintConfig`
  has exactly one `weight` field (`constraints.proto` field 4).
- `ConstraintScope` carries **`offering_id` and `kind_id` only** — there is no
  person axis, so the app cannot emit one constraint instance per lecturer to
  give each its own weight.
- And the wire has no offering scope either, which is why offering-scoped rows
  are **skipped** rather than degraded: "Skipped rather than degraded to
  unscoped, which would silently WIDEN the rule". That is the standing precedent
  for what to do when the wire cannot express a scoping axis — refuse, do not
  approximate.

So the app cannot pre-resolve a per-person multiplier into
`ConstraintConfig.weight`: one scalar cannot represent N different per-lecturer
multipliers, and collapsing them (to a mean, or to the maximum) would be exactly
the silent widening the offering-scope skip exists to prevent. The multiplier is
per-Person data and must travel with the Person, like `blackouts` already does.

The division of labour that follows: **the app resolves the tenant weight and
the clamp; the solver multiplies.** `ConstraintConfig.weight` stays the tenant
default (unchanged mechanism, no change to `toWireConstraint`), `Preference.
weight_multiplier` carries only an already-validated in-range factor, and the
solver's cost is `weight × multiplier × fit`. The solver should still clamp
defensively on read — it accepts possibly-invalid input by design — but the
authority for the range is the app's write boundary and its CHECK.

**Do not reuse `Unavailability`.** It is structurally identical and semantically
inverted; the app schema already carries a comment warning that "two adjacent
tables with opposite emptiness semantics is exactly what a later reader gets
wrong". Reusing the message on the wire would guarantee that reader is a
compiler that cannot warn. A separate message with the inversion stated in its
own comment costs one message and removes the trap.

**No `weeks` field**, per §2 — a preference is a recurring weekly shape. Adding
`weeks` later is additive if that turns out to be wanted.

**No integer-index array.** The Rooms/Persons/Groups pattern of id-keyed
messages that the solver densifies into indices already applies: this hangs off
`Person`, so it inherits that treatment and needs no parallel structure.

### 5.2 On the constraint side — field 27

The `oneof params` uses 10–17 and 20–26 (26 = `MinimizeBlockUsage`), so **27 is
the next free number in the soft band**.

```proto
    PersonPreferenceFit person_preference_fit = 27;

// SOFT. Reward placements landing in a Person's stated preferred days/blocks.
// The VALUES live on Person.preferred; this message is the tenant-level switch
// and (via Constraint.weight) how much the tenant cares. Same architecture as
// LecturerVeto, one severity down.
message PersonPreferenceFit {
  // Which role_tags' preferences are counted. Empty = lecturers only.
  repeated string roles = 1;
}
```

The `roles` field is how 4.1 stays decidable later without a second bump; if
4.1(i) is chosen permanently, ship the message empty (`params: []` in the
catalogue) and add the field when needed — also additive.

### 5.3 App-side catalogue

A new entry in `shared/constraintTypes.ts`: `key: 'person_preference_fit'`,
`wireField: 'personPreferenceFit'`, `evaluator: 'solver'`, `severity: 'SOFT'`.

**Not enabled by default.** `defaultConstraintRow` auto-enables only the four
structural types, and `CLAUDE.md` records the reason: flipping a rule's
direction for a tenant that already configured it is safe, enabling a
previously-off rule for everyone is not. A preference rule that switches itself
on and starts moving timetables at the next deploy is exactly the surprise that
policy exists to prevent.

---

## 6. Solver-side objective integration

**RECOMMENDED, with real confidence: fold into `soft`. Do not give it its own
`Objective` field.** This is the answer the prompt asked to have flagged, and it
differs from day-mix for a specific reason.

### Why it differs from day-mix

`Objective.day_mix_cost` exists as a separate field, and its own comment states
the criterion:

> SEPARATE FROM `soft`, and the split is about how each is maintained rather
> than about what they mean. `soft` is a per-placement unary cost the search
> accumulates as a delta; this is read whole off the counters, like `aggregate`,
> because a mixed cell belongs to no single placement.

A preference cost **does** belong to a single placement: put this Session at
that (day, block), and the cost is determined — no other placement participates.
So it is `soft` by the stated criterion, not by preference. Three consequences
follow:

1. It is delta-accumulated like the other six soft types, so the existing
   incremental-objective machinery and its debug drift assertion cover it
   unchanged.
2. **`ruin_worst` sees it correctly.** That operator ranks placements by their
   soft contribution, which is precisely why it is blind to `day_mix_cost` and
   `aggregate`. A placement-local preference term is the kind of thing it was
   built to rank. This is the representation choice that avoids repeating the
   day-mix visibility problem — and it is a reason to resist §4.2's
   normalization, which would forfeit it.
3. No new field means no new place for the objective breakdown and the search to
   disagree.

Note the standing caveat: `ruin_worst` currently ranks by soft only, which is
0.017% of the objective at large-university, so it is steering by a rounding
error. That is a tracked solver-side defect, not a reason to shape this term
differently — and correcting it (score total objective contribution) makes this
term *more* useful, not less.

### The representation problem, and the proposal

The existing soft table is indexed by **`(profile, slot, room)`**, where a
*profile* is the set of soft instances applying to one tenant `kind`. Tenants
have one or two profiles, so the table is small.

**A preference cost does not fit that key**, because it depends on *who attends
this placement* — which varies per placement, not per kind. Keying it into the
profile dimension would mean one profile per distinct preference signature,
i.e. potentially one per placement, and the table stops being small.

The way out is the fact recorded in §2: **a preference has no week axis, so its
cost is a function of `(day, block)` only, not of the full slot.** That collapses
the precomputation:

```
pref_cost[placement][day][block]     // f32
```

**The entry already IS the mean.** `pref_cost[placement][day][block]` stores
`( Σ_{p∈P} m(p) × fit(p, day, block) ) / |P|` — the whole combination from the
formula above, collapsed at setup. It is deliberately **not** a per-lecturer
table combined at scoring time: that would put an aggregation over `P` inside the
candidate loop and forfeit the single property that made this representation
worth building. Closing the multi-lecturer gap must not reintroduce a
per-candidate aggregation step, and storing the mean is what prevents it.

The multiplier folds in at the same moment, so no clamp arithmetic happens in the
hot loop either; the tenant weight stays outside the table, because it is one
scalar for the whole run and multiplying it in would mean rebuilding the table
whenever the weight changes.

Built once at setup from each placement's counted lecturer set (§4.1). Size at
`large-university` — 27,136 placements × 5 active days × 8 blocks ≈ **1.1 M
entries, ~4.3 MB**. The naive `placement × slot` table would be 27,136 × 924 ≈
25 M entries (~100 MB) for the same information, because it would store each
`(day, block)` value once per week of the term.

Scoring a candidate is then `slot → (day, block) → one indexed read`, exactly
the O(1) exact delta the other six soft types get, and the attendee scan happens
`placements × 1` times at setup rather than once per candidate evaluation. That
last point matters: the solver's largest measured win to date (31× on
construction) came from hoisting an attendee scan out of a hot loop, and pricing
preferences per-candidate would put one straight back in.

`SoftParams` gains a `PersonPreferenceFit { roles }` variant; the table is built
alongside the existing `(profile, slot, room)` one and added at the same point.

#### What the precomputation depends on, and when it would break

Collapsing `P` at setup is only valid because **a placement's lecturer set is
fixed before the search starts.** That holds today for a specific reason: genuine
lecturer-*pool* selection is unimplemented — `candidate_lecturer_ids` +
`required_lecturer_count` supports only the degenerate case where the pool equals
the requirement, and a real pool returns `UNIMPLEMENTED` (see BACKLOG.md,
"Lecturer consistency across an Offering's Sessions", item 1).

If pool selection ever lands, **`P` becomes a decision variable**, the mean can no
longer be precomputed per placement, and this table's key is wrong — it would need
`(placement, chosen-lecturer-set, day, block)`, which is not a table. The likely
shape then is a per-lecturer table `pref_cost[person][day][block]` (small: people
× days × blocks) with the mean taken over the currently-chosen set at scoring
time, accepting an O(|P|) scoring step in exchange for a set that can change.

Recording it here because that is a **cross-repo coupling that is invisible from
either side**: whoever implements pool selection will not be looking at this
document, and the failure would be silent — a stale mean over the lecturers the
Offering happened to list first, still bounded, still plausible, quietly pricing
the wrong people's preferences.

### The two decisions support each other, not just coexist

Staying placement-local was argued above from `ruin_worst` visibility. It earns
its place twice more, and the second reason only became visible once §4 settled:

- **It is what makes §4's bounded override tractable.** A placement-local term
  has a per-placement quantity to normalise to `0.0..=1.0`, so the type's
  contribution to `hard_penalty` is `tenant_weight × max_multiplier` — a fixed
  ceiling independent of instance data. An aggregate term has no per-placement
  quantity at all, so a per-person weight inside it could not be bounded the
  same way, and §4 would have been forced back to the flat tenant-wide option.
- **It keeps the precomputation small**, because §4.1's lecturers-only scope
  means the set folded into each `pref_cost[placement][day][block]` entry is 1–2
  people rather than ~65.

So the decision chain runs one way: **lecturers-only + raw accrual ⇒
placement-local ⇒ a normalisable per-placement ceiling ⇒ a per-person override
that cannot escape the bound.** Reversing any link breaks the last one, which is
why §4.2 says to revisit only on a real complaint.

### The cost of one placement, and how several lecturers combine

The first draft wrote the formula for a single lecturer:

```
tenant_weight × clamp(multiplier, 0.5, 2.0) × fit          // WRONG: assumes L = 1
```

That is incomplete, and the gap matters: §4's own safety argument establishes
that a placement can carry several required lecturers, each with their own
`weight_multiplier`, and the formula never said how their contributions combine.
**The combination rule is what decides whether §4's ceiling holds**, so this is
the missing half of that proof rather than a new decision on top of it.

**DECIDED: the MEAN across the placement's counted lecturer set, taken over the
product `multiplier × fit` jointly.**

For a placement with counted lecturer set `P` (per §4.1) at `(day, block)`:

```
fit(p)      ∈ 0.0..=1.0            // p's own normalised satisfaction
m(p)        = clamp(p.weight_multiplier ?? 1.0, 0.5, 2.0)

cost = tenant_weight × ( Σ_{p∈P} m(p) × fit(p) ) / |P|          // |P| ≥ 1
cost = 0                                                        // |P| = 0
```

#### Why mean and not sum

Each lecturer's own term `m(p) × fit(p)` is bounded by `max_multiplier × 1.0`.
From there the two candidates diverge exactly where it counts:

- **Sum** over `L = |P|` lecturers is bounded by `max_multiplier × L`. That puts
  `L` — how many lecturers this Offering happens to require, an
  **instance-data** quantity — back into the ceiling. It is precisely the
  dependence §4's `0.0..=1.0` normalisation was introduced to remove, and it
  returns the moment a second lecturer appears on a placement. A tenant could
  then push this type's contribution to `hard_penalty` arbitrarily high by
  raising `required_lecturer_count`, with no weight change and no warning.
- **Mean** stays bounded by `max_multiplier` for every `L`, because an average
  of terms each ≤ `B` is itself ≤ `B`. That is what actually delivers the
  `tenant_weight × max_multiplier` ceiling §4 claims.

So §4's conclusion was right and its mechanism was one step short. Mean supplies
the step.

#### Why the mean is over the PRODUCT, not over each factor separately

These two are **not** interchangeable, and a reader skimming the formula is
likely to assume they are:

```
mean( m × fit )        ≠        mean(m) × mean(fit)
```

Because `mean(a × b) ≠ mean(a) × mean(b)` whenever `a` and `b` covary — and here
they do, since a lecturer's multiplier and whether *their* preference is
satisfied are independent facts about that lecturer. A concrete case with two
lecturers, multipliers `0.5` and `2.0`, fits `1.0` and `0.0`:

| form | value |
|---|---|
| `mean(m × fit)` = (0.5×1.0 + 2.0×0.0) / 2 | **0.25** |
| `mean(m) × mean(fit)` = 1.25 × 0.5 | **0.625** |

Two and a half times apart on the same placement. **The joint mean is the correct
one**, and the reason is attribution rather than magnitude: the separated form
applies the *average* multiplier to the *average* fit, so the lecturer with the
2.0 multiplier inflates the cost even though the placement suits them perfectly
and it is the 0.5 lecturer who is inconvenienced. It charges the institution for
caring a lot about someone who got what they wanted.

Note that both forms happen to respect the ceiling (`mean(m) ≤ 2.0` and
`mean(fit) ≤ 1.0`, so the product is ≤ 2.0 as well). **Boundedness is therefore
not what decides between them** — correct attribution is. Worth saying plainly,
because "both are bounded" is exactly the observation that would let someone
pick the wrong one and still pass a bound check.

#### `|P| = 0`, which is reachable

`Offering.required_lecturer_count` is a `uint32`, and proto3 scalars default to
0 — so an Offering that never sets it requires no lecturer at all. That is not a
theoretical case: a tenant-defined `staff_meeting` kind is the obvious real one,
and the solver's own notes already warn that such a kind "may have no Group at
all".

The mean is undefined at `|P| = 0`, so **cost = 0**: no counted lecturer means
no preference signal, and 0 is the identity of a term the rule has nothing to
say about.

**Resolve it at table-build time, not at read time.** The scoring path must stay
a branch-free indexed read (see below), so a placement with no counted lecturers
gets `0.0` written into every `(day, block)` entry rather than a conditional in
the hot loop. A consequence worth naming: that makes "no lecturers" numerically
indistinguishable from "lecturers who stated no preference", which is correct —
both mean the rule has nothing to say here — but it also means an enabled rule
can be entirely inert if no lecturer has filled anything in. Stage 4's assembly
report is where that becomes visible, and it should count placements with a zero
preference row for exactly this reason. Otherwise this is the `lecturer_veto`
shape again: a rule that looks configured and can never fire.

### If §4.2 is ever revisited to normalization

Then this section inverts: the term becomes aggregate, needs its own
`Objective` field maintained off counters in `aggregates.rs`, `ruin_worst`
cannot see it, a fourth ruin arm or the `ruin_worst` correction becomes a
prerequisite rather than an improvement — **and §4's bounded per-person override
loses its safety argument**, because there is no per-placement quantity left to
normalise. Revisiting §4.2 therefore reopens §4, not just §6.

---

## 7. Proposed rollout — PROPOSED, NOT COMMITTED

Analogous to the solver's own Stage 1–7 plan, and deliberately marked proposed:
this has had no build session.

**Stages 1–4 are closed.** 1–3 on 2026-08-26, 4 on 2026-08-27. Stage 3's tag
turned out to be published after all (the row said otherwise and had gone stale),
which is what unblocked 4. Stages 5–7 have had no build session; 5 and 6 are
solver-side work that does not belong in this repo.

| Stage | Scope | Gate |
|---|---|---|
| ~~1~~ | **DONE, 2026-08-26.** Decisions taken: §2 additive; §4 tenant default with a per-person multiplier clamped to `[0.5, 2.0]`; §4.1 lecturers only; §4.2 raw per-placement; §1 widen the row, with a room-type kind next. Two follow-ups fall out of it and belong to stage 2/3 rather than here: write the additive semantics into the `PersonPreference` schema comment, and decide keys-vs-join-table for the room-type kind. | passed |
| ~~2~~ | **DONE, 2026-08-26.** Catalogue entry (SOFT, off by default, `wireField` unset so it skips), the `weight_multiplier` column + CHECK + staff-only clamp validation, the additive-semantics schema comment, and the staff UI control. Two tests falsified rather than trusted. | passed |
| ~~3~~ | **DONE, and PUBLISHED.** `Person.preferred` (5), `Preference` with `optional double weight_multiplier`, `PersonPreferenceFit` (27); tagged `v0.7.0`; solver pin moved and its `convert.rs` given an explicit `Status::unimplemented` branch, because the exhaustive match made "present but unread" impossible. **Correction, 2026-08-27:** this row said "NOT PUSHED / NOT PUBLISHED" and that had gone stale — the registry lists `0.7.0` and serves it as `latest`. `package.json` was still pinned `^0.5.0`, and a caret on a `0.x` range does not cross a minor, so the app went on resolving `0.5.0` and `Person.preferred` was absent from the generated types. Bumped to `^0.7.0` and installed. | `buf lint` + `buf breaking` clean and falsified two ways; 12-assertion old-peer wire check; solver `cargo build`/`clippy`/`test` (102) green |
| ~~4~~ | **DONE, 2026-08-27.** `statedPreferencesFor` in `server/utils/availability.ts` is the single read path (no status filter — preferences have no state machine, §3). `assembleSolverInput` narrows every stated value to THIS Term's grid, populates `Person.preferred`, and reports four numbers: `lecturersWithPreference`, `droppedOutOfGridValues`, `placementsWithNoSignal`, `placementsCounted`. A NULL `weight_multiplier` is sent as ABSENT, never 0. `wireField` deliberately NOT set — see the sequencing note below. | 8 assertions in `tests/person-preference-wire.test.ts`, falsified two ways: removing the grid filter fails 2 of them, coercing NULL to 0 fails 1. The inert count is asserted in both directions, and the shared fixture's lecturer-less offering supplies the `|P| = 0` case |
| 5 | Solver: `SoftParams::PersonPreferenceFit`, the `pref_cost[placement][day][block]` table, integration into `soft`, drift-assertion coverage. | `cargo test`; the incremental-objective drift assertion; **plus the mean-not-sum test below** |
| 6 | **Prove it fires.** A falsification test (rule disabled ⇒ identical placements; enabled ⇒ different) plus a real solve showing placements move toward preferred blocks at the configured weight. | Follows the calendar-period precedent: a probe period, then a solve at the *original* weight |
| 7 | Remove the "Recorded, not yet used by the scheduler" disclaimer from `/my/preferences`, and the "STORED BUT NOT YET SOLVER-EFFECTIVE" note from the schema. | Stage 6 green |

**Stage 7 is last, and that ordering is the point.** The disclaimer is currently
the only thing keeping this feature honest with the people entering data into
it. Removing it before stage 6 passes would turn a truthful "we record this" into
an untrue "we use this".

### Where `wireField` gets flipped — stage 5, never stage 4

**Found while building stage 4, and the stage table never said it.** The
catalogue entry's `wireField` is what decides whether `person_preference_fit`
crosses the wire at all. Flipping it is not part of stage 4 and must wait for
stage 5, because the solver's `convert.rs` currently answers that variant with

```
Status::unimplemented("person_preference_fit is in the schema but not yet evaluated")
```

That is a `StartRun` failure, not a skipped rule. So the ordering is:

| `wireField` | solver | what a tenant who enables the rule gets |
|---|---|---|
| unset (today) | refuses | rule reported as unable to cross; **every solve still succeeds** |
| set, before stage 5 | refuses | **every solve fails outright** |
| set, with stage 5 | evaluates | the feature |

The middle row is strictly worse than the first, and it is one line away. Stage 4
therefore populates `Person.preferred` — an unread field costs a few bytes and
nothing else — while leaving the constraint uncrossable, which is why the
assembly can ship ahead of the evaluator without a flag.

### What count (a) actually turned out to be

The stage 4 row called it "preferences that cannot cross the wire", by analogy
with the equipment-quantity and multi-room counts. Once `Person.preferred` exists
that framing has no referent: days, blocks and the multiplier all cross, so
nothing about a preference is inexpressible.

The real narrowing is **values this Term's grid has no day or block for**, and it
comes from a deliberate asymmetry already recorded in `shared/availability.ts`:
the write boundary validates against the tenant's **widest** grid, because a
preference is not term-scoped and must stay expressible for every grid the tenant
has. At solve time exactly one grid is in force. A stored `block 9` is therefore
legitimate data and an impossible slot in the same breath — dropped, counted, and
never sent as a slot the solver would have to reject.

One consequence worth pinning, and it is tested: a preference whose every value
falls outside the grid narrows to nothing, and is then sent as an **absent**
`Preference` rather than an empty one. After narrowing "stated nothing" and
"stated nothing usable" are the same fact, and that fact keeps one
representation — while `droppedOutOfGridValues` still records that something was
thrown away.

### Stage 4 must report the inert case, not just the undeliverable one

The two counts in stage 4's row answer different questions and only one of them
was in the first draft.

**(a) Preferences that cannot cross the wire** is the familiar narrowing report —
the same shape as `assembleSolverInput`'s equipment-quantity and multi-room
counts, protecting against silent data loss.

**(b) Placements with no preference signal** is the one this design added, and it
is not a narrowing at all: nothing was dropped, there was simply nothing to say.
Two situations collapse into it — a placement with an empty counted-lecturer set
(reachable: `required_lecturer_count` is a `uint32` defaulting to 0, so a
`staff_meeting` kind requires none), and a placement whose lecturers all have no
stated preference. Both correctly price to 0.

**Why it needs to be a counted, testable line rather than a remark in §6:** a
tenant can enable `person_preference_fit`, give it a weight, see it rendered as
active in the constraint grid, and have it contribute exactly nothing to every
placement in the run. That is the `lecturer_veto` shape — a HARD rule enabled by
default and fed an empty list, which "looked healthy and could never fire" — and
the reason it went unnoticed there is precisely that nothing counted it. The
count is what makes "configured but inert" distinguishable from "configured and
satisfied", which are otherwise the same zero.

The fixture matters as much as the count: a stage-4 test whose tenant happens to
have preferences on every lecturer would report `0` for (b) and pass without
exercising the path. One placement with no required lecturers is enough.

### Stage 5 must pin the combination rule by falsification

One test, and it has to be written the way this project writes them — so that it
fails against the wrong implementation rather than merely passing against the
right one.

**Fixture:** one placement with **≥2 required lecturers** whose multipliers
*differ* and whose fits *differ* — the 2-lecturer case from §6 (`0.5`/`2.0`
multipliers, `1.0`/`0.0` fits) is already the discriminating one.

**Assert:**

1. the objective contribution equals the **mean** form, `0.25 × tenant_weight`;
2. **and that the sum form would have produced a different, higher number** for
   this same fixture (`0.5 × tenant_weight`), so the test cannot pass against an
   implementation that sums;
3. **and that `mean(m) × mean(fit)` would have produced a third, different
   number** (`0.625 × tenant_weight`) — because that is the wrong form a reader
   is most likely to write from skimming the formula, and it is the one a
   bound check would not catch.

Equal multipliers or equal fits make all three forms agree, so a fixture built
from uniform values proves nothing. That is the trap this test exists to avoid,
and it is the same discipline as the `buf breaking` check that was verified by
deliberately renumbering a field, and the slice-4 falsification tests that found
two real search defects by being written to fail first.

A second, cheaper case: a placement with **zero** counted lecturers contributes
exactly 0, and the table row for it is all zeros rather than being special-cased
at read time.

### What must not happen

The failure mode to avoid is named in the schema comment already, and it is
worth restating as a checklist item because this feature is one wrong default
away from it:

> This is NOT the `lecturer_veto` bug repeating itself. That one was a HARD
> constraint, enabled by default in every tenant, silently fed an empty list —
> it looked healthy and could never fire.

Three properties keep this feature out of that hole, and stages 2–6 must each
preserve them: **SOFT** (so a mistake prices rather than refuses), **off by
default** (so no tenant's timetable moves without someone choosing it), and
**the data path proven before the promise is made** (stage 6 before stage 7).

---

## Decisions, collected

All five resolved on 2026-08-26. Reasoning lives in the sections; this is the
index.

| # | Question | Decision |
|---|---|---|
| §1 | Extensibility | **Widen `person_preference`.** A room-type kind is next and is grid-shaped, so it does not trigger the new-table branch. Open sub-choice for that kind: `Equipment.key` text array versus a small join table — join table recommended, since `Equipment` is a real entity. Trigger for a genuinely new table: a preference that is not a set over one axis (a numeric target, a pairwise rule). |
| §2 | How the axes combine | **Additive** — each axis earns credit independently. Must be written into the `PersonPreference` schema comment at stage 2. |
| §4 | Weight model | **Tenant-wide default × a per-person multiplier clamped to `[0.5, 2.0]`.** A multiplier rather than an absolute override because it survives a change to the tenant default. Nullable column, `NULL` = use the default, validated at both write boundaries and backed by a CHECK. Management-only: the self-service path must refuse it. |
| §4.1 | Whose preferences count | **Lecturers only**, via the existing `role_tags`. Stated in the catalogue description so the scope is not read as a bug. |
| §4.2 | Accrual | **Raw, per placement.** Keeps the term placement-local, which is what makes both `ruin_worst` visibility and §4's bound work. |
| §6 | Multi-lecturer combination | **Mean over the placement's counted lecturers, of the product `multiplier × fit`.** Sum would put the lecturer count back into the `hard_penalty` ceiling; averaging the two factors separately is a different number and mis-attributes cost. `\|P\| = 0` ⇒ cost 0, resolved at table-build time. |

### What changed in this revision, and why it matters

- **The refusal of per-person weights was too broad.** What made the original
  Option B unsafe was unboundedness, not per-person-ness. A clamped multiplier
  plus a `0.0..=1.0` normalised fit gives a ceiling of
  `tenant_weight × max_multiplier`, computable from configuration alone.
- **The weight does cross the wire**, on `Preference`, not on the constraint. The
  app cannot pre-resolve it: `toWireConstraint` emits one scalar per constraint
  row and `ConstraintScope` has no person axis, so there is no per-lecturer
  constraint instance to attach a weight to. Verified in code rather than
  assumed — see §5.1.
- **A plausible shortcut in the safety argument is false.** "At most one
  person's weight applies per placement" does not hold: `required_lecturer_count`
  permits several lecturers on one placement. The bound survives because the fit
  is normalised to `0.0..=1.0` first, not because the counted set has one member.
- **The multi-lecturer combination rule was unresolved, and is now MEAN, not
  sum.** §6's formula had been written for a single lecturer, so it never said
  how several lecturers' `multiplier × fit` terms become the one scalar the
  objective needs — and that rule is what decides whether §4's ceiling holds.
  Summing is bounded by `max_multiplier × L`, which puts the lecturer count (an
  instance-data quantity) back into the bound; the mean is bounded by
  `max_multiplier` for any `L`. §4's conclusion was right and its mechanism was
  one step short.

  **The mean is over the PRODUCT**, because `mean(a × b) ≠ mean(a) × mean(b)`
  when the factors covary — and a lecturer's multiplier and whether *their* own
  preference is satisfied do covary. Two lecturers with multipliers `0.5`/`2.0`
  and fits `1.0`/`0.0` give `0.25` jointly versus `0.625` separated. Both forms
  respect the ceiling, so **a bound check cannot catch the wrong one**; the joint
  form is correct because the separated one charges the institution for caring
  about a lecturer who got exactly what they wanted. This is called out here
  specifically because it is the step a future implementer is most likely to get
  wrong by reading the formula and not the proof.

  Two consequences recorded with it: the `pref_cost` table entry must already BE
  the mean (otherwise scoring regains a per-candidate aggregation and the whole
  representation loses its point), and the precomputation is valid only while a
  placement's lecturer set is fixed — genuine lecturer-pool selection would make
  `P` a decision variable and break the table's key silently.

### Still genuinely open, and deliberately out of scope here

- The keys-versus-join-table choice for the **room-type** preference kind (§1).
  It belongs to that kind's own stage 1, not to this one.
- The exact clamp numbers. `[0.5, 2.0]` is a policy proposal; the design only
  requires that a small maximum exist.
- Everything in stages 2–7, which have had no build session.
