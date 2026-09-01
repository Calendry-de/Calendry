-- ---------------------------------------------------------------------------
-- calendry_internal.staff_create_federation() / staff_set_tenant_federation()
-- — issue #64, the UI half
-- ---------------------------------------------------------------------------
--
-- `scripts/provision-federation.ts` (issue #64's CLI half) already argued
-- correctly against a TENANT-facing `/api/federations` route: letting a
-- tenant admin join any federation it merely knows the id/slug of has real,
-- consent-free visibility consequences (CLAUDE.md exception 1). That
-- argument says nothing about a STAFF-facing route — `requireStaffIdentity`
-- gates it the same way `POST /api/staff/tenants` is gated, and issue #76
-- already scoped "tenant creation from the UI" as in-scope for exactly this
-- panel. These two functions are the SAME technique #105 used for tenant
-- creation: narrow, parameterized SECURITY DEFINER functions callable
-- through the ORDINARY `calendry_app` role, so `POST /api/staff/federations`
-- and `PATCH /api/staff/tenants/:id` need no standing owner connection —
-- only `GET /api/staff/federations` (a plain cross-tenant READ, not a write)
-- still goes through `getOwnerPrisma()`, matching `GET /api/staff/tenants`'s
-- own precedent (CLAUDE.md's "Staff" row: listing is "outside #105's scope").
--
-- IDEMPOTENT BY LOOKUP-THEN-CREATE, matching `staff_create_tenant()` and
-- `provision-federation.ts`: creating a Federation that already exists (by
-- slug) returns the existing row with `already_existed = true` rather than
-- raising a unique-constraint error the route would have to map anyway.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION calendry_internal.staff_create_federation(
    p_slug text,
    p_name text
)
RETURNS TABLE (
    id              text,
    slug            text,
    name            text,
    created_at      timestamptz,
    already_existed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, calendry_internal, pg_temp
AS $fn$
DECLARE
    v_id text;
    v_existed boolean;
BEGIN
    SELECT f.id INTO v_id FROM "federation" f WHERE f.slug = p_slug;
    v_existed := v_id IS NOT NULL;

    IF NOT v_existed THEN
        v_id := calendry_internal.uuid_v7()::text;

        INSERT INTO "federation" (id, slug, name, updated_at)
        VALUES (v_id, p_slug, p_name, now());
    END IF;

    RETURN QUERY
    SELECT f.id, f.slug, f.name, f.created_at, v_existed
    FROM "federation" f
    WHERE f.id = v_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION calendry_internal.staff_create_federation(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION calendry_internal.staff_create_federation(text, text) TO calendry_app;

-- ---------------------------------------------------------------------------
-- Attach/detach: a Tenant's OWN `federation_id`, changed in place.
--
-- `p_federation_id => NULL` detaches. Raises `no_data_found` (P0002) for an
-- unknown tenant id OR an unknown (non-null) federation id — the route maps
-- both the same way `staff_create_tenant()`'s route already maps that code
-- for an unknown federation slug, distinguishing the two cases by which
-- input it echoes back.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION calendry_internal.staff_set_tenant_federation(
    p_tenant_id     text,
    p_federation_id text
)
RETURNS TABLE (
    tenant_id     text,
    tenant_slug   text,
    federation_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, calendry_internal, pg_temp
AS $fn$
BEGIN
    IF p_federation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "federation" WHERE id = p_federation_id) THEN
        RAISE EXCEPTION 'No federation with id ''%''.', p_federation_id USING ERRCODE = 'no_data_found';
    END IF;

    UPDATE "tenant" t
    SET federation_id = p_federation_id, updated_at = now()
    WHERE t.id = p_tenant_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No tenant with id ''%''.', p_tenant_id USING ERRCODE = 'no_data_found';
    END IF;

    RETURN QUERY
    SELECT t.id, t.slug, t.federation_id
    FROM "tenant" t
    WHERE t.id = p_tenant_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION calendry_internal.staff_set_tenant_federation(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION calendry_internal.staff_set_tenant_federation(text, text) TO calendry_app;
