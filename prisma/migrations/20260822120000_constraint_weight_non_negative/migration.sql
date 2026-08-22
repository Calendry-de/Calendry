SET search_path = public;

-- ---------------------------------------------------------------------------
-- A soft constraint's weight may not be negative
-- ---------------------------------------------------------------------------
--
-- `constraint_weight_matches_severity` already lives on this table and enforces
-- the HARD ⇒ NULL / SOFT ⇒ NOT NULL pairing. It says nothing about the VALUE,
-- so `weight = -5` was storable — confirmed against the running API, which
-- returned 201 for exactly that payload.
--
-- WHY A NEGATIVE WEIGHT IS NOT MERELY ODD
--
-- Every soft type in the catalogue declares "minimize". The solver refuses a
-- negative weight for that reason (calendry-solver, convert.rs::soft_instance:
-- "a negative weight would invert it"), but that check sits at the far end of
-- the wire and only fires when someone starts a run. The row is stored long
-- before then, and the tenant sees a rule that looks configured.
--
-- The second effect is worse and is not local to the one rule. The solver
-- derives its hard-violation penalty from the weights themselves:
--
--     hard_penalty = sum(all soft weights) * placements + 1     (problem.rs)
--
-- That sum is what guarantees a hard violation outranks every reachable soft
-- configuration. A negative weight SUBTRACTS from it, so one badly-typed number
-- in an unrelated soft rule erodes the priority guarantee for every hard
-- constraint in the tenant — and with enough negative weight the penalty goes
-- negative, at which point the search is rewarded for breaking hard rules.
--
-- WHY ZERO IS ALLOWED
--
-- Deliberately `>= 0` and not `> 0`, matching the solver rather than the
-- builder's `min` attribute. Zero is meaningful: the constraint is evaluated
-- and its breach count is reported, but it does not steer the search. A floor
-- of 1 would reject a configuration the solver accepts, which is the same
-- builder-stricter-than-API divergence that produced this gap.
--
-- WHY HERE AND NOT ONLY IN ZOD
--
-- The API refinement added alongside this gives the actionable message; this
-- gives the guarantee. `provision-tenant.ts` writes baseline constraints with
-- `tx.constraint.createMany` and never passes through `RESOURCES`, so a check
-- that lives only in the resource schema is one a script can walk around. NOT
-- VALID is not used: every existing row already satisfies this (audited, 10
-- rows, all weights >= 1), so the constraint is validated immediately and the
-- table is known-clean rather than carrying an unchecked remainder.
ALTER TABLE public.constraint_def
    ADD CONSTRAINT constraint_weight_non_negative
    CHECK (weight IS NULL OR weight >= 0);
