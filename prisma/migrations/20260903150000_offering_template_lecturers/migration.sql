-- ---------------------------------------------------------------------------
-- offering_template gains a named lecturer roster (issue #129)
-- ---------------------------------------------------------------------------
--
-- `required_role_id` stayed a Role reference so the shape never hardcoded an
-- individual — but nothing downstream ever read it (issue #129's audit: zero
-- occurrences in assembleSolverInput, no picker filter, no seed into the
-- created Offering's pool). So a template built from issue #8's own
-- motivating example, "Maths, 4x/week, Mr Schmidt", captured everything
-- except Mr Schmidt, and applying a curriculum plan produced Offerings with
-- an empty lecturer pool every time (issue #130).
--
-- offering_template_lecturer is the template's own half of offering_lecturer:
-- one row per named Person, copied onto the created Offering's own
-- offering_lecturer rows at apply time (server/utils/offeringPlans.ts), never
-- a live link — the same "seed, don't bind" contract every other template
-- column already keeps, so editing a template's roster does not retroactively
-- restaff Offerings already created from it.
--
-- required_lecturer_count mirrors offering.required_lecturer_count for the
-- same reason every other template column mirrors an Offering column: so
-- "two co-teachers on every session" survives being copied rather than
-- needing to be re-typed on each created Offering. This column already had a
-- zod schema and a manage-registry form field (server/utils/resources.ts,
-- app/utils/manageRegistry.ts) with nowhere to land: the generic CRUD route's
-- `delegate()` erases Prisma's static typing (`args: unknown`), so setting it
-- through the UI compiled clean and would have failed at the FIRST save with
-- a raw "Unknown argument `requiredLecturerCount`" from Prisma. Landed here
-- rather than filed as a third ticket, since it is the same gap this
-- migration already exists to close.

ALTER TABLE "offering_template" ADD COLUMN "required_lecturer_count" INTEGER;

CREATE TABLE "offering_template_lecturer" (
    "template_id" TEXT NOT NULL,
    "person_id"   TEXT NOT NULL,
    "tenant_id"   TEXT NOT NULL,
    "role_id"     TEXT,

    CONSTRAINT "offering_template_lecturer_pkey" PRIMARY KEY ("template_id", "person_id")
);

ALTER TABLE "offering_template_lecturer"
    ADD CONSTRAINT "offering_template_lecturer_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "offering_template_lecturer"
    ADD CONSTRAINT "offering_template_lecturer_template_id_fkey"
    FOREIGN KEY ("template_id") REFERENCES "offering_template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "offering_template_lecturer"
    ADD CONSTRAINT "offering_template_lecturer_person_id_fkey"
    FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL, not RESTRICT, matching offering_lecturer.role_id: the scheduling
-- Role recorded here is a label on the row, not a fact whose loss should block
-- deleting the Role itself.
ALTER TABLE "offering_template_lecturer"
    ADD CONSTRAINT "offering_template_lecturer_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "offering_template_lecturer_person_id_idx" ON "offering_template_lecturer" ("person_id");
CREATE INDEX "offering_template_lecturer_tenant_id_idx" ON "offering_template_lecturer" ("tenant_id");

-- Same explicit, self-contained RLS shape offering_template itself uses
-- (rather than the generic tenant_scoped array further up the squashed
-- migration, which predates the template family): tenant-scoped, no
-- federation sharing, FORCE so the owner role obeys it too.
ALTER TABLE "offering_template_lecturer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "offering_template_lecturer" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "offering_template_lecturer"
    USING (tenant_id = calendry_internal.current_tenant_id())
    WITH CHECK (tenant_id = calendry_internal.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "offering_template_lecturer" TO calendry_app;
