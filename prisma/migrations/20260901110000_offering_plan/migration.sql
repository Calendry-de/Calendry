-- ---------------------------------------------------------------------------
-- offering_plan / offering_plan_item: reusable, ordered curriculum plans
-- ---------------------------------------------------------------------------
--
-- A plan bundles several `offering_template` rows so applying it to a Group
-- creates that Group's whole course load in one action. The item table
-- carries no shape of its own — applying reads each referenced template's
-- CURRENT fields, the same "copy happens at use, not at authoring" rule the
-- template table itself already follows for the Offerings it seeds.
--
-- Both foreign keys CASCADE, unlike `offering.created_from_template_id`'s
-- SET NULL: that column is pure provenance on an already-complete row, but a
-- plan item IS the reference, so deleting its plan or its template leaves
-- nothing worth keeping a dangling row for.
--
-- Tenant-scoped and RLS-protected like every other core entity, and NOT
-- federation-ownable, matching `offering_template`'s own reasoning: a plan is
-- this institution's own naming of its own recurring load, not a resource a
-- federation shares.
-- ---------------------------------------------------------------------------
CREATE TABLE "offering_plan" (
    "id"        TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,

    "name"        TEXT NOT NULL,
    "description" TEXT,

    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "offering_plan_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "offering_plan" ADD CONSTRAINT "offering_plan_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "offering_plan_tenant_id_idx" ON "offering_plan" ("tenant_id");

ALTER TABLE "offering_plan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "offering_plan" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "offering_plan"
    USING (tenant_id = calendry_internal.current_tenant_id())
    WITH CHECK (tenant_id = calendry_internal.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "offering_plan" TO calendry_app;

CREATE TABLE "offering_plan_item" (
    "id"        TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,

    "plan_id"     TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "position"    INTEGER NOT NULL,

    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offering_plan_item_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "offering_plan_item" ADD CONSTRAINT "offering_plan_item_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "offering_plan_item" ADD CONSTRAINT "offering_plan_item_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "offering_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "offering_plan_item" ADD CONSTRAINT "offering_plan_item_template_id_fkey"
    FOREIGN KEY ("template_id") REFERENCES "offering_template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "offering_plan_item_tenant_id_idx" ON "offering_plan_item" ("tenant_id");
CREATE INDEX "offering_plan_item_plan_id_idx" ON "offering_plan_item" ("plan_id");
CREATE INDEX "offering_plan_item_template_id_idx" ON "offering_plan_item" ("template_id");

ALTER TABLE "offering_plan_item" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "offering_plan_item" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "offering_plan_item"
    USING (tenant_id = calendry_internal.current_tenant_id())
    WITH CHECK (tenant_id = calendry_internal.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "offering_plan_item" TO calendry_app;
