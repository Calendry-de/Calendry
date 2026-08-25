SET search_path = public;

-- ---------------------------------------------------------------------------
-- Anchor a week-scoped absence to the term whose weeks it counts
-- ---------------------------------------------------------------------------
--
-- WHAT WAS WRONG, MEASURED RATHER THAN REASONED
--
-- `Unavailability.weeks` is documented on the wire as "index into
-- AcademicCalendar.weeks" — and that calendar is built PER SOLVE, for the one
-- term being solved. `person_unavailability` had no term reference, so
-- `approvedBlackoutsFor` sent every approved row to every solve.
--
-- Against the demo tenant, one stored row of `weeks:[2]` was sent unchanged to
-- both terms, where week 2 begins:
--
--     test             week[2] starts 2026-09-07
--     Wintersemester   week[2] starts 2027-10-11
--
-- Thirteen months apart, from one row. For the RECURRING pattern the previous
-- slice shipped (days/blocks, no weeks) this is harmless — a Friday is a Friday
-- in every term. For a date-range absence it is a correctness hole: "I am away
-- the week of 7 September 2026" would also empty a week of the following
-- academic year.
--
-- The previous slice's proposal said the weeks column and its wire mapping were
-- already complete and only the UI was narrowed. That was TRUE — verified with a
-- live solve, which moved placements out of the blacked-out weeks — and it was
-- not the whole story, because nothing had ever written a weeks row and so the
-- ambiguity had never had a chance to be wrong.
--
-- NULL MEANS EVERY TERM
--
-- Which is what the recurring pattern wants and what every existing row means,
-- so this migration needs no backfill and changes no behaviour for them.
-- A term-scoped row applies only to that term's solves.
--
-- Note this is NOT the fail-open choice `group_term` made for its own reasons.
-- The CHECK below removes the case where fail-open would be wrong.

ALTER TABLE "person_unavailability" ADD COLUMN "term_id" TEXT;

-- CASCADE: a term's week indices mean nothing once the term is gone, and a row
-- pointing at a deleted term would be silently inert — the exact failure this
-- whole feature exists to stop. RESTRICT would instead make a term
-- undeletable because somebody once booked a holiday in it.
ALTER TABLE "person_unavailability" ADD CONSTRAINT "person_unavailability_term_id_fkey"
    FOREIGN KEY ("term_id") REFERENCES "term"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A week index with no term is the ambiguous state above, and it is now
-- unrepresentable rather than merely discouraged.
--
-- One-directional on purpose. The converse — a term with no weeks — is
-- meaningful: "I do not teach Fridays, but only in Wintersemester" is a
-- perfectly ordinary thing to record, and forbidding it would be this constraint
-- inventing a rule nobody asked for.
ALTER TABLE "person_unavailability" ADD CONSTRAINT "person_unavailability_weeks_need_a_term"
    CHECK (cardinality(weeks) = 0 OR term_id IS NOT NULL);

-- The solver read path filters `term_id IS NULL OR term_id = <term>`.
CREATE INDEX "person_unavailability_term_id_idx" ON "person_unavailability" ("term_id");
