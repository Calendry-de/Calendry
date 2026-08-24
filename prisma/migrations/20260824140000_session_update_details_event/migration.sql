SET search_path = public;

-- ---------------------------------------------------------------------------
-- UPDATE_DETAILS — editing what an Event IS, as distinct from where it sits
-- ---------------------------------------------------------------------------
--
-- The log's vocabulary held seven verbs, all about PLACEMENT or lifecycle:
-- CREATE, MOVE, SWAP, DELETE, LOCK, UNLOCK, APPLY_GENERATION. Nothing described
-- changing a Session's title, kind, groups or people, because until Events
-- existed those were never editable — they came from the Offering or from
-- solver output.
--
-- WHY A NAMED VERB AND NOT A GENERIC "UPDATE"
--
-- CLAUDE.md's routing convention: editing operations are explicit verbs on the
-- Session resource, "not generic PATCHes, so the event log can record intent,
-- not just a diff". A row saying UPDATE would push the reader back into the
-- payload to learn what happened; UPDATE_DETAILS says it changed what the event
-- IS, and MOVE already says the other thing.
--
-- ADD VALUE INSIDE A MIGRATION
--
-- Safe here. PostgreSQL forbids USING a new enum value in the same transaction
-- that adds it, not adding one — and this migration only adds. The first row
-- carrying it is written by a later request. (Server is PG 18.1.)
ALTER TYPE "session_event_type" ADD VALUE IF NOT EXISTS 'UPDATE_DETAILS';
