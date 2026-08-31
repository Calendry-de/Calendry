-- ===========================================================================
-- Cancel-to-spare-bank (issue #22), the state half.
--
-- A cancelled Offering-linked Session no longer sits at a (term_week,
-- day_of_week, block_index) but must keep existing: it still counts toward
-- its Offering's `frequency`, still carries its Group/Person/Room links, and
-- still needs to be found and re-placed by a human later. Deleting the row
-- (the existing behaviour, `session/[id].delete.ts`) throws that away — the
-- next solve just invents a replacement, and the fact that THIS teaching was
-- cancelled rather than never scheduled is gone.
--
-- NULLABLE, NOT A NEW STATUS COLUMN. The three placement columns already mean
-- "this Session sits here"; there is nowhere else the fact would need to live.
-- The same shape the schema already uses for "no recurring demand"
-- (`session.offering_id IS NULL` = an Event) and "not yet enrolled"
-- (`offering.required_capacity IS NULL` = derived) — null is a state here,
-- not an absence. `shared/sessionPlacement.ts` is the one place that reads it.
-- ===========================================================================

ALTER TABLE "session" ALTER COLUMN "term_week" DROP NOT NULL;
ALTER TABLE "session" ALTER COLUMN "day_of_week" DROP NOT NULL;
ALTER TABLE "session" ALTER COLUMN "block_index" DROP NOT NULL;

-- Replaces the all-required version from the init migration. A banked Session
-- has all three NULL together — never a mix, which is what would make "no
-- placement" indistinguishable from "half-written row" to every reader of
-- this column. `duration_blocks >= 1` is unconditional: even banked, a
-- Session still has a length, since that is what a later placement reuses.
ALTER TABLE "session" DROP CONSTRAINT "session_placement_sane";
ALTER TABLE "session" ADD CONSTRAINT session_placement_sane
    CHECK (
        duration_blocks >= 1
        AND (
            (term_week IS NULL AND day_of_week IS NULL AND block_index IS NULL)
            OR (term_week >= 1 AND day_of_week BETWEEN 1 AND 7 AND block_index >= 0)
        )
    );

-- ADD VALUE INSIDE A MIGRATION: safe here for the same reason it was safe in
-- the init migration's own additions (UPDATE_DETAILS, SET_LECTURERS) —
-- PostgreSQL forbids USING a new enum value in the same transaction that adds
-- it, not adding one, and this migration only adds. The first BANK row is
-- written by a later request.
ALTER TYPE "session_event_type" ADD VALUE IF NOT EXISTS 'BANK';
