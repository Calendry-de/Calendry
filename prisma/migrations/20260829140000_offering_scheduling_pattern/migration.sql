SET search_path = public;

-- ---------------------------------------------------------------------------
-- How an Offering's demand should distribute across the Term
-- ---------------------------------------------------------------------------
--
-- `Offering.frequency` says "this happens 12 times" and nothing about HOW those
-- twelve land. Two institutions mean opposite things by it:
--
--   DISTRIBUTED  a consistent weekly slot for the whole Term ("Mondays at 10,
--                every week"). Widely ASSUMED today and enforced by nothing —
--                the solver may legitimately place each week independently, so
--                a course can land on a different day every week.
--   BLOCK        the whole demand concentrated into a short contiguous window
--                ("all twelve in one fortnight"). Common for modular and
--                professional programmes.
--
-- These are not variations of one rule; they pull in opposite directions.
--
-- A NULLABLE COLUMN, AND NULL IS NOT A THIRD PATTERN. It means the Offering has
-- not been classified, which is every Offering that exists today and the honest
-- state for one nobody has thought about. It maps to the wire's
-- `SCHEDULING_PATTERN_UNSPECIFIED`, which is exactly the same claim. Defaulting
-- to DISTRIBUTED would have been the tempting move — it is what most timetables
-- assume — and it would have written an institution's assumption into every
-- existing row as though somebody had chosen it.
--
-- CLASSIFICATION ONLY, IN THIS MIGRATION. Nothing changes about any solve: this
-- column reaches `Offering.scheduling_pattern` on the wire, and the solver acts
-- on it only through the `DistributedPatternAdherence` / `BlockPatternAdherence`
-- constraint types, which no tenant can enable until they exist in the app's own
-- catalogue. So no timetable moves because of this, and a tenant can classify
-- its Offerings before the rule that reads them is switchable.
--
-- A POSTGRES ENUM, not a text column with a CHECK: the values are FIXED by the
-- proto (`SchedulingPattern`), not tenant vocabulary, and TAXONOMY.md's open/
-- fixed split is what decides that. A new pattern is a schema change in three
-- repos, which is precisely the friction an enum should impose here.
-- ---------------------------------------------------------------------------
CREATE TYPE "scheduling_pattern" AS ENUM ('DISTRIBUTED', 'BLOCK');

ALTER TABLE "offering" ADD COLUMN "scheduling_pattern" "scheduling_pattern";
