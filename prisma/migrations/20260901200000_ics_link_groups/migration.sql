-- ---------------------------------------------------------------------------
-- ics_link_group: a calendar link may target Group(s) instead of its own
-- Person (issue #115)
-- ---------------------------------------------------------------------------
--
-- Same shape as `session_group`: a join row per (link, Group) pair, cascade-
-- deleted with either side. An `ics_link` with no rows here streams its
-- creator's own Sessions, unchanged from issue #15 — see that table's own
-- comment, updated alongside this migration.
-- ---------------------------------------------------------------------------
CREATE TABLE "ics_link_group" (
    "ics_link_id" TEXT NOT NULL,
    "group_id"    TEXT NOT NULL,
    "tenant_id"   TEXT NOT NULL,

    CONSTRAINT "ics_link_group_pkey" PRIMARY KEY ("ics_link_id", "group_id")
);

ALTER TABLE "ics_link_group"
    ADD CONSTRAINT "ics_link_group_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ics_link_group"
    ADD CONSTRAINT "ics_link_group_ics_link_id_fkey"
    FOREIGN KEY ("ics_link_id") REFERENCES "ics_link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ics_link_group"
    ADD CONSTRAINT "ics_link_group_group_id_fkey"
    FOREIGN KEY ("group_id") REFERENCES "group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "ics_link_group_group_id_idx" ON "ics_link_group" ("group_id");
CREATE INDEX "ics_link_group_tenant_id_idx" ON "ics_link_group" ("tenant_id");

ALTER TABLE "ics_link_group" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ics_link_group" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "ics_link_group"
    USING (tenant_id = calendry_internal.current_tenant_id())
    WITH CHECK (tenant_id = calendry_internal.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ics_link_group" TO calendry_app;

-- ---------------------------------------------------------------------------
-- calendry_internal.ics_link_identity() gains group_ids
-- ---------------------------------------------------------------------------
--
-- DROP + CREATE, not CREATE OR REPLACE: the RETURNS TABLE shape gains a
-- column, and Postgres refuses to change a function's OUT columns in place.
-- The REVOKE/GRANT pair is repeated because DROP removes both.
--
-- `group_ids` is aggregated here rather than joined in `resolveIcsLink()`'s
-- caller: this function already runs SECURITY DEFINER against the RLS-
-- protected `ics_link`/`ics_link_group` tables before any tenant context
-- exists, exactly like `person_active` riding along above it.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS calendry_internal.ics_link_identity(text);

CREATE FUNCTION calendry_internal.ics_link_identity(p_token text)
RETURNS TABLE (
    link_id       text,
    tenant_id     text,
    federation_id text,
    person_id     text,
    person_active boolean,
    scope         "ics_link_scope",
    term_id       text,
    weeks_ahead   integer,
    group_ids     text[]
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $fn$
    SELECT
        l.id, l.tenant_id, t.federation_id, l.person_id, p.is_active,
        l.scope, l.term_id, l.weeks_ahead,
        COALESCE(
            (SELECT array_agg(lg.group_id) FROM ics_link_group lg WHERE lg.ics_link_id = l.id),
            ARRAY[]::text[]
        )
    FROM ics_link l
    JOIN tenant t ON t.id = l.tenant_id
    JOIN person p ON p.id = l.person_id
    WHERE l.token = p_token
$fn$;

REVOKE EXECUTE ON FUNCTION calendry_internal.ics_link_identity(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION calendry_internal.ics_link_identity(text) TO calendry_app;
