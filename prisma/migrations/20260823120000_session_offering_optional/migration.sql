SET search_path = public;

-- ---------------------------------------------------------------------------
-- Offering-less Sessions ("Events")
-- ---------------------------------------------------------------------------
--
-- `session.offering_id` becomes NULLABLE. A Session with no Offering is an
-- EVENT: a placement that exists in its own right rather than as one occurrence
-- of a recurring demand — an exam sitting, a staff gathering, a one-off
-- lecture. See TAXONOMY.md §2, "Offering-less Sessions (Events)".
--
-- WHY THE COLUMN AND NOT A SYNTHETIC OFFERING
--
-- The alternative was a frequency-1 Offering behind every Event, which needs no
-- migration. It was rejected because it puts rows in the DEMAND model that are
-- not demand: the Offering list becomes a mix of "this must happen 12 times"
-- and "this happened once on the 14th", and every solve then has to be told to
-- ignore the second kind. The scope default makes that failure quiet — a run
-- with no explicit `offeringIds` takes EVERY Offering in the term, so a
-- forgotten exclusion means the solver owns the Event.
--
-- WHY THIS IS THE SAFE DIRECTION, NOT THE RISKY ONE
--
-- The delete partition in `planMaterialization()` is:
--
--     !keptIds.has(s.id) && !s.isLocked && inScope.has(s.offeringId)
--
-- `inScope` is a Set of offering ids, so `inScope.has(NULL)` is false and an
-- Event is STRUCTURALLY exempt from being deleted by an apply — it cannot be
-- swept up by a solve that never knew about it. That is a stronger guarantee
-- than the lock flag, which is one UPDATE away from being cleared, and it is
-- the main reason this shape was chosen over the synthetic-Offering one.
--
-- Events are additionally created with `is_locked = true` by default. That is
-- defence in depth, not the primary protection.
--
-- WHAT DOES *NOT* CHANGE
--
--  * Existing rows all keep their offering_id — this only widens what is
--    permitted, so it is a pure relaxation and needs no backfill.
--  * The FK stays, with its ON DELETE CASCADE. A NULL simply does not
--    participate: deleting an Offering still removes its Sessions, and an
--    Event has no Offering to be deleted.
--  * `session.kind_id` stays NOT NULL. What an Event IS remains tenant
--    vocabulary and is still required — an Event with no kind would be
--    unnameable in the UI.
--  * RLS is untouched. Ownership is `tenant_id`/`federation_id`; the Offering
--    was never part of the isolation story.
ALTER TABLE "session" ALTER COLUMN "offering_id" DROP NOT NULL;

COMMENT ON COLUMN "session"."offering_id" IS
    'NULL means this Session is an Event — a placement with no recurring demand '
    'behind it (TAXONOMY.md §2). An Event is in no solve''s scope and is sent to '
    'the solver as immovable occupancy.';

-- The solver's exclusion query gains the Event case. `session_unlocked_placement_idx`
-- already covers (tenant_id, term_id, ...) WHERE is_locked = false; nothing
-- about a NULL offering_id changes which rows that index carries, so no index
-- is added here. (See CLAUDE.md § "Resolved, with the reasoning kept" for why
-- speculative indexes are measured before being created.)
