-- ---------------------------------------------------------------------------
-- room.footprint_tags: several Room identities sharing one physical space
-- (issue #122)
-- ---------------------------------------------------------------------------
--
-- Three rooms behind movable walls (1.0, 1.1, 1.2) are one room with the
-- walls open (the Audimax). Booking any one must make the others and the
-- whole unbookable for that slot. Nothing in the model could say this:
-- no_double_booking_room is a property of one Room against itself across
-- time, never a relationship between Rooms.
--
-- The proto's Room.footprint_tags (0.17.0, solver df7d88d, ADR-0022's third
-- addendum) is an open-vocabulary tag: Rooms carrying the same tag share a
-- footprint. SYMMETRIC by construction (a Room may carry several, one per
-- wall it shares), and a tag only one Room carries is inert rather than an
-- error, so a half-entered configuration does not fail a run. Structural and
-- HARD, reported under RoomDoubleBooking naming both Rooms. This column is
-- the app's half; toWireRoom sends it verbatim.
--
-- A VIRTUAL Room has no physical footprint and the solver REFUSES a tag on
-- one at conversion, which would surface as a failed run long after the
-- save. The CHECK moves that refusal to the write, where mapDbErrors turns
-- it into a 422 naming the constraint.

ALTER TABLE "room" ADD COLUMN "footprint_tags" TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE "room" ADD CONSTRAINT "room_virtual_has_no_footprint"
    CHECK (NOT ("is_virtual" AND cardinality("footprint_tags") > 0));
