-- ---------------------------------------------------------------------------
-- session_kind.requires_lecturer (issue #130)
-- ---------------------------------------------------------------------------
--
-- Declares whether an Offering of this kind is expected to carry a lecturer.
-- Additive and NOT NULL DEFAULT true: every kind that predates this column
-- keeps today's behaviour (a lecturer is expected), and no backfill script is
-- needed because SessionKind rows are entirely tenant-authored — nothing
-- seeds them, so there is no fixed set of existing rows to repair the way a
-- Constraint or Permission row would need.
--
-- See the schema.prisma doc comment for why this exists: an empty
-- offering_lecturer pool is otherwise indistinguishable from "this kind never
-- needs one", because the solver reads both as "requires zero lecturers".

ALTER TABLE "session_kind" ADD COLUMN "requires_lecturer" BOOLEAN NOT NULL DEFAULT true;
