-- ---------------------------------------------------------------------------
-- offering_plan.next_plan_id: a plan's successor, for "advance this Group"
-- ---------------------------------------------------------------------------
--
-- "Semester 3" points at "Semester 4" so a Group already on a plan can move
-- into the next Term with no picker — see the column's own schema comment
-- for why this is a hint, not a verified chain: nothing here enforces
-- acyclic or single-stranded, because nothing downstream walks more than
-- one hop, so nothing is corrupted by a bad link, only mis-suggested.
--
-- SET NULL on delete, matching `offering.created_from_template_id`'s own
-- reasoning: deleting a plan must not block on, or cascade into, whichever
-- OTHER plan named it as a successor.
-- ---------------------------------------------------------------------------
ALTER TABLE "offering_plan" ADD COLUMN "next_plan_id" TEXT;

ALTER TABLE "offering_plan"
    ADD CONSTRAINT "offering_plan_next_plan_id_fkey"
    FOREIGN KEY ("next_plan_id") REFERENCES "offering_plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "offering_plan_next_plan_id_idx" ON "offering_plan" ("next_plan_id");
