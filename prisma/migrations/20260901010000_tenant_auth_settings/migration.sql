-- ===========================================================================
-- Tenant-configured default access role for new People (issue #25).
-- ===========================================================================

ALTER TABLE "person_access_role" ADD COLUMN "is_default_grant" BOOLEAN NOT NULL DEFAULT false;

-- Authorization config, deliberately separate from tenant_display_settings —
-- see the model's own doc comment in schema.prisma.
CREATE TABLE "tenant_auth_settings" (
    "tenant_id"               TEXT NOT NULL,
    "default_access_role_id"  TEXT,

    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_auth_settings_pkey" PRIMARY KEY ("tenant_id")
);

ALTER TABLE "tenant_auth_settings" ADD CONSTRAINT "tenant_auth_settings_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT, not CASCADE/SetNull: deleting an AccessRole that is some
-- tenant's configured default must fail loudly (the generic delete route's
-- existing 23503 -> 409 mapping), never silently clear the setting or leave
-- a dangling reference that quietly stops granting.
ALTER TABLE "tenant_auth_settings" ADD CONSTRAINT "tenant_auth_settings_default_access_role_id_fkey"
    FOREIGN KEY ("default_access_role_id") REFERENCES "access_role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tenant_auth_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_auth_settings" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "tenant_auth_settings"
    USING (tenant_id = calendry_internal.current_tenant_id())
    WITH CHECK (tenant_id = calendry_internal.current_tenant_id());

-- The blanket GRANT in the init migration applied only to tables existing at
-- that time (see its own comment at the `group_source` table above it).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "tenant_auth_settings" TO calendry_app;
