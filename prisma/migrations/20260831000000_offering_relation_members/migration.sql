-- ===========================================================================
-- OfferingRelation membership (ADR-0028 in calendry-solver): the ordered set
-- of Offering references a relation-shaped constraint (e.g. `different_time`)
-- names. The `Constraint` row IS the relation; this table is only its
-- membership. See the model's own doc comment in schema.prisma for why this
-- is a NEW carrier rather than `constraint_scope` (filter vs operand).
-- ===========================================================================
CREATE TABLE "constraint_relation_member" (
    "id"            TEXT NOT NULL,
    "tenant_id"     TEXT NOT NULL,
    "constraint_id" TEXT NOT NULL,
    "offering_id"   TEXT NOT NULL,
    -- Stored even though the one relation type built so far (`different_time`)
    -- is symmetric and ignores it — an order-dependent type added later
    -- (Precedence) cannot retrofit an order onto rows that never had one.
    "position"      INTEGER NOT NULL,

    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "constraint_relation_member_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "constraint_relation_member" ADD CONSTRAINT "constraint_relation_member_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "constraint_relation_member" ADD CONSTRAINT "constraint_relation_member_constraint_id_fkey"
    FOREIGN KEY ("constraint_id") REFERENCES "constraint_def"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "constraint_relation_member" ADD CONSTRAINT "constraint_relation_member_offering_id_fkey"
    FOREIGN KEY ("offering_id") REFERENCES "offering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- An Offering appearing twice in the same relation is never meaningful — it
-- either says nothing (DifferentTime with itself) or says something no
-- relation type here defines.
CREATE UNIQUE INDEX "constraint_relation_member_constraint_id_offering_id_key"
    ON "constraint_relation_member" ("constraint_id", "offering_id");

CREATE INDEX "constraint_relation_member_tenant_id_idx" ON "constraint_relation_member" ("tenant_id");
CREATE INDEX "constraint_relation_member_offering_id_idx" ON "constraint_relation_member" ("offering_id");

ALTER TABLE "constraint_relation_member" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "constraint_relation_member" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "constraint_relation_member"
    USING (tenant_id = calendry_internal.current_tenant_id())
    WITH CHECK (tenant_id = calendry_internal.current_tenant_id());

-- The blanket GRANT in the init migration applied only to tables existing at
-- that time (see its own comment at the `group_source` table above it).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "constraint_relation_member" TO calendry_app;
