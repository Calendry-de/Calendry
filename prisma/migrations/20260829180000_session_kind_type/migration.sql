SET search_path = public;

-- ---------------------------------------------------------------------------
-- What ROLE a Session kind plays, as opposed to what a tenant calls it
-- ---------------------------------------------------------------------------
--
-- `session_kind.key` is OPEN vocabulary: a tenant calls its exams `exam`,
-- `Klausur`, `assessment` or anything else, and TAXONOMY.md's open/fixed split
-- means no logic may assume a particular string. That rule stands. What was
-- missing is the other half of it — a way for a tenant to DECLARE that a kind
-- it named itself is an exam, so a rule can act on the declaration instead of
-- on the name.
--
-- Until now the only mechanism was `ConstraintScope`: a tenant hand-scoped
-- `exam_spacing_same_day` to the right kind and the rule worked. Two problems
-- with that, and the second is the reason this exists:
--
--   * `applies_to_kinds` EMPTY MEANS EVERY KIND on the wire, not none. So
--     forgetting to scope those rules does not disable them — it turns "no two
--     exams in a day" into "no two sessions of any kind in a day", silently, as
--     a live rule on the next solve.
--   * The claim "this kind is our exam kind" was expressed once per rule
--     rather than once per kind, so two rules could disagree and nothing could
--     notice.
--
-- A POSTGRES ENUM, not a text column with a CHECK, for the same reason
-- `scheduling_pattern` is one: the values are FIXED (schema-level), while the
-- kind's `key` and `name` stay tenant vocabulary. This column and that column
-- are the fixed/open split drawn through one table.
--
-- ADMIN IS DELIBERATELY UNREAD. Staff meetings, open days — a kind that is
-- neither taught nor assessed. Nothing acts on it today; it exists so the
-- distinction can be recorded before a rule needs it, and so TEACHING does not
-- have to absorb sessions that are not teaching. An unused enum value costs
-- nothing; retrofitting one onto rows already classified costs a data
-- migration nobody can do correctly after the fact.
--
-- DEFAULT 'TEACHING' for every existing row, then corrected below.
-- ---------------------------------------------------------------------------
CREATE TYPE "session_kind_type" AS ENUM ('TEACHING', 'EXAM', 'ADMIN');

ALTER TABLE "session_kind"
    ADD COLUMN "type" "session_kind_type" NOT NULL DEFAULT 'TEACHING';

-- ---------------------------------------------------------------------------
-- Backfill: the data already knows which kind is the exam kind
-- ---------------------------------------------------------------------------
--
-- THIS IS THE HALF THAT CANNOT BE SKIPPED. `exam_spacing_same_day` and
-- `exam_spacing_window` stop reading `ConstraintScope` in this release and read
-- this column instead. A tenant who had hand-scoped one of them to `Klausur`
-- and is not migrated here would have the rule DERIVE AN EMPTY KIND SET — and
-- since the app refuses to send an empty derived scope rather than let it mean
-- "all kinds", the rule would go quiet on the next solve with nothing on screen
-- having changed.
--
-- That is the failure mode this codebase keeps meeting under different names: a
-- rule that looks configured and no longer fires. It is avoidable here because
-- the answer is already written down — scoping `exam_spacing_*` to a kind IS
-- the statement "this kind is an exam", made in the only place that could hold
-- it before this column existed.
--
-- Deliberately NOT filtered on `is_enabled`: a disabled rule still records the
-- tenant's classification, and inferring from enabled rows only would leave a
-- kind unclassified for having its rule temporarily switched off.
-- ---------------------------------------------------------------------------
UPDATE "session_kind" k
SET "type" = 'EXAM'
WHERE EXISTS (
    SELECT 1
    FROM "constraint_scope" cs
    JOIN "constraint_def" c ON c."id" = cs."constraint_id"
    WHERE cs."kind_id" = k."id"
      AND c."type" IN ('exam_spacing_same_day', 'exam_spacing_window')
);
