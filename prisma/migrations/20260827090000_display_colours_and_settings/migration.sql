-- Display colour, and one place per tenant to say what the schedule highlights.
--
-- HAND-WRITTEN, like every migration here. `prisma migrate dev` diffs against
-- schema.prisma, which cannot express RLS policies, triggers or grants — it
-- would emit a migration that silently DROPS them, leaving every table present
-- and tenant isolation gone with every test still passing (CLAUDE.md).

-- ---------------------------------------------------------------------------
-- 1. Offering carries its own colour.
--
-- Nullable, and deliberately so: null means "inherit", which is what lets the
-- resolution order (offering -> session kind -> default) stay meaningful. A
-- default value here would make every Offering claim a colour it never chose.
-- Mirrors `session_kind.color`, which has worked this way since Step 13.
-- ---------------------------------------------------------------------------
ALTER TABLE "offering" ADD COLUMN "color" TEXT;

-- ---------------------------------------------------------------------------
-- 2. Per-tenant display settings.
--
-- A SINGLETON, keyed by tenant_id as the primary key rather than a surrogate
-- id with a unique index. That is the whole point: "there is at most one row of
-- settings per tenant" is then unrepresentable-otherwise rather than enforced
-- by a constraint somebody could drop. There is no `id` column because a second
-- row is not a thing that should be able to exist.
--
-- Absent row = defaults. Provisioning does not seed one, and the read path
-- falls back — so a tenant that has never opened the page behaves exactly like
-- one that opened it and changed nothing.
-- ---------------------------------------------------------------------------
CREATE TABLE "tenant_display_settings" (
    "tenant_id" TEXT NOT NULL,

    -- Whether a Session in a virtual Room is marked on the schedule at all.
    -- Online delivery is a virtual Room and never a flag on Session
    -- (TAXONOMY.md); this setting decides how that fact is DRAWN, and stores no
    -- second copy of it.
    "highlight_online" BOOLEAN NOT NULL DEFAULT true,
    "online_color" TEXT,

    -- Where a Session's colour comes from when several sources could supply
    -- one. Stored as an ordered list so the tenant states a precedence rather
    -- than the renderer hardcoding one.
    "color_source_order" TEXT[] NOT NULL DEFAULT ARRAY['offering', 'kind']::TEXT[],

    -- The chip colour when nothing else supplies one.
    "default_color" TEXT,

    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

    CONSTRAINT "tenant_display_settings_pkey" PRIMARY KEY ("tenant_id")
);

ALTER TABLE "tenant_display_settings"
    ADD CONSTRAINT "tenant_display_settings_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant-scoped, so it is isolated at the DB layer like everything else. The
-- app role owns nothing and runs under FORCE ROW LEVEL SECURITY.
ALTER TABLE "tenant_display_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_display_settings" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "tenant_display_settings"
    USING (tenant_id = calendry_internal.current_tenant_id())
    WITH CHECK (tenant_id = calendry_internal.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "tenant_display_settings" TO calendry_app;
