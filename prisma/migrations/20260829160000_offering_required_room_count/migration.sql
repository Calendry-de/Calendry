SET search_path = public;

-- ---------------------------------------------------------------------------
-- How many Rooms one Session of an Offering needs AT ONCE
-- ---------------------------------------------------------------------------
--
-- The app could already record that a Session happens to occupy two Rooms. It
-- could not state that an Offering REQUIRES two — a cohort too large for any
-- single hall, a practical needing two labs in parallel.
--
-- Those are different claims. The first is a fact about a placement that
-- already exists; the second is demand the solver must satisfy when choosing
-- where to put one. Only the second can make a placement ineligible.
--
-- NOT NULL DEFAULT 1, and that is a real difference from its neighbours on this
-- table. `required_capacity` is nullable because NULL means DERIVED, and
-- `scheduling_pattern` because NULL means UNCLASSIFIED — in both cases a third
-- state that is not a value. There is no third state here: every Session
-- occupies at least one Room, so 1 is the answer rather than a stand-in for the
-- absence of one. Every existing row means 1 and always did.
--
-- WHY THE CHECK, AND WHY 4 SPECIFICALLY. `MAX_ADDITIONAL_ROOMS = 3` in the
-- solver's `crates/core/src/solution.rs` fixes a Placement's Room array at 1
-- primary + 3 additional, and `convert.rs` REFUSES an Offering above that with
-- `TooManyRoomsRequired` — refuses, not truncates, because a demand it cannot
-- meet is not something to warn-and-allow.
--
-- So a stored 5 is not a large number, it is a term that cannot be solved: every
-- run FAILS for the whole tenant, with an error naming an Offering somebody
-- edited weeks earlier. The database refusing it is the difference between an
-- input mistake caught at the keystroke and a scheduling outage. `shared/
-- rooms.ts` holds the same 4 for the form and the write schema, so the three
-- agree by construction rather than by memory.
--
-- CAPACITY IS SUMMED ACROSS THE COMBINATION, and that is decided upstream, not
-- here: `Offering.required_room_count` in the proto says so in as many words,
-- and the solver builds Room combinations whose capacities it adds before
-- comparing against `min_capacity`. The alternative reading — each Room must
-- independently hold the whole Group — is a coherent thing for a tenant to
-- want, gives the opposite answer on identical input, and is NOT what this
-- column means. The form says which, rather than leaving it to be discovered
-- from a timetable that looks wrong.
-- ---------------------------------------------------------------------------
ALTER TABLE "offering"
    ADD COLUMN "required_room_count" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "offering"
    ADD CONSTRAINT "offering_required_room_count_within_solver_limit"
    CHECK ("required_room_count" BETWEEN 1 AND 4);
