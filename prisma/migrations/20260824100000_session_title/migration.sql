SET search_path = public;

-- ---------------------------------------------------------------------------
-- Session.title — a name for an EVENT
-- ---------------------------------------------------------------------------
--
-- `session` had no nameable column at all. Every display site derived its label
-- from the Offering (`session.offering.title`), which an ad-hoc Event does not
-- have — so an Event rendered as the literal string "Untitled session" on the
-- grid, in the inspector and in the off-grid tray, and as an EMPTY STRING in
-- the placement banner, which had no fallback.
--
-- WHOSE NAME THIS IS
--
-- An EVENT's, and only an Event's. An Offering-linked Session keeps deriving
-- its name from its Offering exactly as before: `sessionLabel()` reads this
-- column only when `offering_id IS NULL`, and `POST /api/sessions` REFUSES a
-- title alongside an offering_id rather than storing one nothing will show.
--
-- Storing-and-ignoring was the alternative and was rejected on this project's
-- usual grounds: a column that silently accumulates values no screen renders is
-- indistinguishable from a bug the first time someone looks. If per-occurrence
-- labels for real Sessions are wanted later ("Week 3: guest lecture"), that is a
-- deliberate feature with its own display rule, not a side effect of this one.
--
-- NULLABLE, AND NOT BACKFILLED
--
-- Every existing row is Offering-linked, so NULL is already the correct value
-- for all of them and there is nothing to migrate. The API requires a title only
-- where it means something — when there is no Offering to borrow a name from.
ALTER TABLE "session" ADD COLUMN "title" text;

COMMENT ON COLUMN "session"."title" IS
    'Display name for an EVENT (offering_id IS NULL). Ignored — and refused on '
    'write — when the Session belongs to an Offering, which supplies the name.';
