-- ---------------------------------------------------------------------------
-- person_unavailability records the DATES of a date-range absence (issue #118)
-- ---------------------------------------------------------------------------
--
-- A person away Wednesday to Friday blocked the WHOLE week: a date range was
-- stored as `days: [], blocks: [], weeks: [touched...]`, every day of every
-- week it touched, because one row of the days x blocks x weeks cross product
-- cannot say "Wed-Fri of week 5, all of week 6, Mon-Tue of week 7" -- that is
-- up to three products -- and splitting one absence into three rows would
-- have made it three separately approvable items in the review queue.
--
-- The proto and solver were checked (calendry-solver 0a16574 pins it by test):
-- the axes INTERSECT, so `{days:[3,4,5], weeks:[5]}` is exactly Wed-Fri of
-- week 5 and nothing else, and `blackouts` is a repeated field. The format
-- was already fully expressive; only this app's spelling rounded.
--
-- So the ROW stays one absence (one approval), and it now carries the real
-- dates. `approvedBlackoutsFor` -- the single solver read path -- expands a
-- dated row into the precise windows at read time; `days`/`blocks`/`weeks`
-- keep their old whole-week value for every reader that lists or counts
-- rows, and for the weeks-need-a-term CHECK. Rows written before this
-- migration have no dates and keep blocking whole weeks: the dates cannot be
-- recovered, and that is what was approved.

ALTER TABLE "person_unavailability"
    ADD COLUMN "absent_from" DATE,
    ADD COLUMN "absent_to"   DATE;

-- Both or neither: a half-dated row would be neither a pattern nor an absence.
ALTER TABLE "person_unavailability" ADD CONSTRAINT "person_unavailability_absence_dates_paired"
    CHECK (("absent_from" IS NULL) = ("absent_to" IS NULL));

ALTER TABLE "person_unavailability" ADD CONSTRAINT "person_unavailability_absence_dates_ordered"
    CHECK ("absent_from" IS NULL OR "absent_from" <= "absent_to");

-- A dated absence is anchored to one term's calendar, like the week indices
-- it expands into; the expansion needs that term's start date.
ALTER TABLE "person_unavailability" ADD CONSTRAINT "person_unavailability_absence_needs_a_term"
    CHECK ("absent_from" IS NULL OR "term_id" IS NOT NULL);
