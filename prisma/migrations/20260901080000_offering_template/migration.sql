-- ---------------------------------------------------------------------------
-- offering_template: a reusable Offering SHAPE (issue #8)
-- ---------------------------------------------------------------------------
--
-- Closest existing machinery is `defaultConstraintRow` (shared/
-- constraintTypes.ts): a stored shape a new row is seeded from, never a live
-- link back to the row it seeded. The difference is authorship — that
-- catalogue is code and this one is tenant-authored data, so it needs a table
-- and CRUD routes rather than a function and a backfill script.
--
-- COPY-NOT-LINK is the whole point and is enforced by SHAPE, not by a
-- trigger: `offering.created_from_template_id` is nullable, ON DELETE SET
-- NULL, and nothing in this app ever reads it to resolve a current Offering
-- field — see that column's own comment below. Every column here mirrors an
-- Offering column it can seed, and is nullable: a template states only the
-- part of the shape it wants to fix.
--
-- Tenant-scoped and RLS-protected like every other core entity — NOT
-- federation-ownable, unlike Room/Equipment/Offering: a template is this
-- institution's own naming of its own recurring shapes, not a resource a
-- federation shares.
-- ---------------------------------------------------------------------------
CREATE TABLE "offering_template" (
    "id"        TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,

    "name" TEXT NOT NULL,

    "title"              TEXT,
    "kind_id"            TEXT,
    "code"               TEXT,
    "color"              TEXT,
    "frequency"          INTEGER,
    "duration_blocks"    INTEGER,
    "scheduling_pattern" "scheduling_pattern",

    -- The "lecturer pool" hint stays a Role, never a specific Person: naming
    -- an individual ("Mr Schmidt") happens on the created Offering's
    -- `offering_lecturer` relation, through the ordinary Offering form, so
    -- the SHAPE itself never hardcodes a person.
    "required_role_id" TEXT,

    "required_capacity"   INTEGER,
    "required_room_count" INTEGER,
    "allow_online"        BOOLEAN,
    "notes"               TEXT,

    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

    CONSTRAINT "offering_template_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "offering_template"
    ADD CONSTRAINT "offering_template_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL, not RESTRICT: deleting a SessionKind or Role a template merely
-- HINTS at must not block that deletion, the same reasoning
-- `offering.created_from_template_id` below carries further.
ALTER TABLE "offering_template"
    ADD CONSTRAINT "offering_template_kind_id_fkey"
    FOREIGN KEY ("kind_id") REFERENCES "session_kind"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "offering_template"
    ADD CONSTRAINT "offering_template_required_role_id_fkey"
    FOREIGN KEY ("required_role_id") REFERENCES "role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "offering_template_tenant_id_idx" ON "offering_template" ("tenant_id");
CREATE INDEX "offering_template_kind_id_idx" ON "offering_template" ("kind_id");
CREATE INDEX "offering_template_required_role_id_idx" ON "offering_template" ("required_role_id");

ALTER TABLE "offering_template" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "offering_template" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "offering_template"
    USING (tenant_id = calendry_internal.current_tenant_id())
    WITH CHECK (tenant_id = calendry_internal.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "offering_template" TO calendry_app;

-- ---------------------------------------------------------------------------
-- offering.created_from_template_id: provenance only, never resolution
-- ---------------------------------------------------------------------------
--
-- Which template (if any) an Offering was CREATED from, for UI convenience
-- ("started from Maths — 4x/week") and analytics — nothing more. The
-- template's field values are copied onto the Offering row at creation time,
-- in application code, once; this column is not consulted afterwards by
-- anything that reads or writes an Offering's fields. Editing a template
-- later must not change a single field of an Offering already made from it,
-- or a term's scheduling history would change under it.
--
-- SET NULL on delete for the same reason a Session survives its Offering's
-- deletion in spirit if not in mechanism: removing a template a tenant no
-- longer wants must not touch the Offerings that merely started there.
-- ---------------------------------------------------------------------------
ALTER TABLE "offering" ADD COLUMN "created_from_template_id" TEXT;

ALTER TABLE "offering"
    ADD CONSTRAINT "offering_created_from_template_id_fkey"
    FOREIGN KEY ("created_from_template_id") REFERENCES "offering_template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "offering_created_from_template_id_idx" ON "offering" ("created_from_template_id");
