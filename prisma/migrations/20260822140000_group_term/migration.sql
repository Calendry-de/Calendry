SET search_path = public;

-- ---------------------------------------------------------------------------
-- Group ↔ Term: which Terms a Group is available in
-- ---------------------------------------------------------------------------
--
-- Until now `group` had NO relation to `term` at any level — not on the table,
-- not through `membership` (which carries only `created_at`, no validity
-- window), not through `constraint_scope` (which scopes by offering and kind),
-- and not on the wire. The only link was transitive and derived:
-- `group -> offering_group -> offering.term_id`.
--
-- The consequence was visible in two places. `assembleSolverInput` sent EVERY
-- tenant Group for every run — measured at 10 sent, 2 actually referenced — and
-- the Offering editor's Group picker offered all of them regardless of which
-- Term the Offering belonged to, so nothing prevented attaching a 2024 cohort
-- to a 2027 Offering.
--
-- The requirement was already asserting itself through a text field: the demo
-- tenant's cohorts are named "dIT22 S1 4.Semester", because the term had
-- nowhere else to live.
--
-- WHY MANY-TO-MANY AND NOT `group.term_id`
--
-- Per-term ownership was considered and rejected on three grounds:
--
--  1. THE PARENT PROBLEM HAS NO GOOD ANSWER. The tree mixes two lifetimes.
--     "dIT22 S1 4.Semester" is a cohort in one term; its parent "IT Security"
--     is a degree programme that persists indefinitely and is never directly
--     scheduled. Owning a Group by a Term means either permitting a parent in a
--     different Term — which abandons the model — or duplicating the programme
--     node every Term, exploding the tree and destroying the identity of the
--     thing it names.
--  2. MEMBERSHIP HAS NO TERM. `membership` is a plain Person↔Group link.
--     Per-term Groups would mean re-adding every student to a NEW Group object
--     each Term, with historical rows pointing at dead Groups, and "which cohort
--     is this student in" would stop having a stable answer.
--  3. IT INVERTS THE NAME. "dIT22" IS the 2022 intake — the thing that persists
--     as it moves through semesters.
--
-- Many-to-many is also a superset: "belongs to exactly one Term" is one row
-- here. The reversibility argument settled it — choosing M2M and finding
-- everyone uses a single Term is harmless, while choosing ownership and finding
-- cohorts persist is a migration that must merge duplicated Groups and
-- reconcile their memberships.
--
-- NO ROW HERE MEANS "AVAILABLE IN EVERY TERM"
--
-- Fail-OPEN, which is the opposite of this codebase's usual instinct and is
-- deliberate. Three reasons:
--
--  * It preserves existing behaviour exactly, so scoping is opt-in rather than a
--    flag day. Fail-closed would make every existing Group unusable the moment
--    this lands.
--  * A newly created Group is immediately usable, instead of invisible until
--    someone remembers a second step.
--  * It stops correctness depending on the backfill being perfect.
--
-- The backfill itself is NOT here. Migrations create no rows (CLAUDE.md); it
-- lives in `prisma/seeds/` and derives scope from actual
-- `offering_group`/`session_group` usage. A freshly migrated database therefore
-- has no scopes at all — harmless precisely BECAUSE unlinked means universal.

CREATE TABLE "group_term" (
    "group_id"  TEXT NOT NULL,
    "term_id"   TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,

    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Composite key: the pair IS the fact, and there is nothing else to say
    -- about it. Same shape as offering_group and session_group.
    CONSTRAINT "group_term_pkey" PRIMARY KEY ("group_id", "term_id")
);

ALTER TABLE "group_term" ADD CONSTRAINT "group_term_group_id_fkey"
    FOREIGN KEY ("group_id") REFERENCES "group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CASCADE on term: deleting a Term removes its scoping rows, which correctly
-- widens the affected Groups back to universal rather than leaving them
-- pointing at a Term that no longer exists.
ALTER TABLE "group_term" ADD CONSTRAINT "group_term_term_id_fkey"
    FOREIGN KEY ("term_id") REFERENCES "term"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "group_term" ADD CONSTRAINT "group_term_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "group_term_term_id_idx" ON "group_term" ("term_id");
CREATE INDEX "group_term_tenant_id_idx" ON "group_term" ("tenant_id");

-- Ordinary tenant-scoped isolation, identical to every other tenant table.
-- Note both sides are already tenant-scoped, so this cannot be used to link a
-- Group to another tenant's Term: the WITH CHECK pins the row's own tenant_id,
-- and the two foreign keys resolve against tables the same policy governs.
ALTER TABLE "group_term" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "group_term" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "group_term"
    USING (tenant_id = calendry_internal.current_tenant_id())
    WITH CHECK (tenant_id = calendry_internal.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "group_term" TO calendry_app;
