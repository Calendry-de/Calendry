SET search_path = public;

-- ---------------------------------------------------------------------------
-- Per-person preference weight: a bounded multiplier on the tenant default
-- ---------------------------------------------------------------------------
--
-- `person_preference_fit` carries ONE tenant-wide weight, the same way
-- `lecturer_veto` carries one tenant-wide switch over per-person blackout data.
-- That cannot express "the department head's preference outranks a first-year
-- tutor's", which is a real institutional fact.
--
-- WHY A BOUNDED MULTIPLIER AND NOT A FREE WEIGHT COLUMN
--
-- The solver derives its hard-violation penalty from the weights themselves:
--
--     hard_penalty = sum(all soft weights) * placements + 1     (problem.rs)
--
-- An unbounded per-row weight would make that sum a function of tenant DATA
-- rather than of the constraint configuration — the same erosion of the
-- hard-outranks-soft guarantee that `constraint_weight_non_negative` exists to
-- prevent, with a wider blast radius because any row could contribute. A factor
-- clamped to [0.5, 2.0] keeps this type's contribution to the bound at
-- `tenant_weight * 2.0`: a fixed ceiling, computable from the constraint
-- configuration alone, independent of how many people hold an override.
--
-- A MULTIPLIER rather than an absolute override, because an absolute value
-- silently rots when the tenant changes its default weight: raising it from 5
-- to 20 turns a row meaning "count this person double" into "count them at a
-- fifth", and keeping every override correct would need a data sweep on each
-- config edit.
--
-- WHY HERE AND NOT ONLY IN ZOD
--
-- Same reasoning as `constraint_weight_non_negative`: the administrator write
-- path gives the actionable message, this gives the guarantee.
-- `provision-tenant.ts` and any future backfill write rows with `createMany`
-- and never pass through the resource schema or a route handler, so a check
-- living only in the API is one a script can walk around.
--
-- NOT VALID is not used: the column is new, so every existing row has NULL and
-- satisfies this immediately. The table is known-clean rather than carrying an
-- unchecked remainder.
ALTER TABLE public.person_preference
    ADD COLUMN weight_multiplier DOUBLE PRECISION;

ALTER TABLE public.person_preference
    ADD CONSTRAINT person_preference_weight_multiplier_range
    CHECK (weight_multiplier IS NULL OR (weight_multiplier >= 0.5 AND weight_multiplier <= 2.0));
