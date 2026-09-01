-- ---------------------------------------------------------------------------
-- calendry_internal.staff_create_tenant() — issue #115
-- ---------------------------------------------------------------------------
--
-- The `member` AccessRole (everybody's baseline — TAXONOMY.md §4, `member`'s
-- own model comment) now also seeds `ics_link.generate_own` alongside
-- `session.read_own`. Before issue #115, ANY signed-in Person could mint a
-- calendar-subscription link with no permission check at all — the new gate
-- would otherwise silently take that capability away from every freshly
-- provisioned tenant's own baseline role, the exact regression
-- `scripts/backfill-ics-link-generate-own.ts` exists to repair on EXISTING
-- tenants. This migration is the same fix for tenants created from now on.
--
-- `tenant-admin` needs no equivalent change here: it is granted the whole
-- `p_permission_keys` catalogue below, which already includes both
-- `ics_link.*` keys once they exist in shared/permissions.ts.
--
-- CREATE OR REPLACE, not DROP + CREATE: the signature is unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION calendry_internal.staff_create_tenant(
    p_slug                  text,
    p_name                  text,
    p_timezone              text,
    p_federation_slug       text,   -- NULL when the tenant joins no Federation.
    p_admin_email           text,   -- already lower-cased by the caller.
    p_admin_given_name      text,
    p_admin_family_name     text,
    p_permission_keys       text[], -- shared/permissions.ts's PERMISSION_KEYS.
    p_default_constraints   jsonb,  -- DEFAULT_CONSTRAINTS, key-renamed to snake_case.
    p_initial_password_hash text    -- hashPassword() output; unused when the Account is reused.
)
RETURNS TABLE (
    tenant_id        text,
    tenant_slug      text,
    tenant_name      text,
    person_id        text,
    person_email     text,
    account_id       text,
    account_reused   boolean,
    lecturer_role_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, calendry_internal, pg_temp
AS $fn$
DECLARE
    v_federation_id        text;
    v_tenant_id             text := calendry_internal.uuid_v7()::text;
    v_lecturer_role_id      text := calendry_internal.uuid_v7()::text;
    v_student_role_id       text := calendry_internal.uuid_v7()::text;
    v_parent_role_id        text := calendry_internal.uuid_v7()::text;
    v_admin_access_role_id  text := calendry_internal.uuid_v7()::text;
    v_member_access_role_id text := calendry_internal.uuid_v7()::text;
    v_person_id             text := calendry_internal.uuid_v7()::text;
    v_account_id            text;
    v_account_reused        boolean;
    v_admin_email           text := lower(p_admin_email);
BEGIN
    IF p_federation_slug IS NOT NULL THEN
        SELECT f.id INTO v_federation_id FROM "federation" f WHERE f.slug = p_federation_slug;

        IF v_federation_id IS NULL THEN
            -- Standard condition, not an invented code — see the defining
            -- migration's file header. server/utils/staffCreateTenant.ts maps
            -- this to the same 400 the app-level UnknownFederationError used
            -- to produce.
            RAISE EXCEPTION 'No federation with slug ''%''. Create it first.', p_federation_slug
                USING ERRCODE = 'no_data_found';
        END IF;
    END IF;

    -- May raise `unique_violation` (23505) on a duplicate slug — deliberately
    -- uncaught here; see the defining migration's "error surface" section.
    INSERT INTO "tenant" (id, federation_id, slug, name, timezone, updated_at)
    VALUES (v_tenant_id, v_federation_id, p_slug, p_name, COALESCE(p_timezone, 'UTC'), now());

    -- Domain vocabulary: the one fixed universal role (TAXONOMY.md §2).
    INSERT INTO "role" (id, tenant_id, key, name, description, is_system, updated_at)
    VALUES (
        v_lecturer_role_id, v_tenant_id, 'lecturer', 'Lecturer',
        'Leads a Session. The one universal domain role.', true, now()
    );

    -- Issue #107. Scheduling vocabulary only, same as `lecturer` above — NOT
    -- wired to any permission grant. What a Student or Parent may DO comes
    -- from an AccessRole (`member`, below), never from holding this Role.
    INSERT INTO "role" (id, tenant_id, key, name, description, is_system, updated_at)
    VALUES (
        v_student_role_id, v_tenant_id, 'student', 'Student',
        'Attends Sessions. Domain vocabulary, not an authority.', true, now()
    );

    INSERT INTO "role" (id, tenant_id, key, name, description, is_system, updated_at)
    VALUES (
        v_parent_role_id, v_tenant_id, 'parent', 'Parent',
        'A student''s guardian. Domain vocabulary, not an authority.', true, now()
    );

    INSERT INTO "access_role" (id, tenant_id, key, name, description, is_system, updated_at)
    VALUES (
        v_admin_access_role_id, v_tenant_id, 'tenant-admin', 'Tenant Administrator',
        'Full access to this tenant.', true, now()
    );

    INSERT INTO "access_role_permission" (access_role_id, permission_key, tenant_id)
    SELECT v_admin_access_role_id, key, v_tenant_id FROM unnest(p_permission_keys) AS key;

    -- The default role: everybody's own timetable (and now their own calendar
    -- link — issue #115), and nothing else — see `member`'s own model comment
    -- for why it is neither `isSystem` nor auto-assigned.
    INSERT INTO "access_role" (id, tenant_id, key, name, description, updated_at)
    VALUES (
        v_member_access_role_id, v_tenant_id, 'member', 'Member',
        'Sees their own timetable. The baseline for everyone at this institution.', now()
    );

    INSERT INTO "access_role_permission" (access_role_id, permission_key, tenant_id)
    VALUES (v_member_access_role_id, 'session.read_own', v_tenant_id);

    INSERT INTO "access_role_permission" (access_role_id, permission_key, tenant_id)
    VALUES (v_member_access_role_id, 'ics_link.generate_own', v_tenant_id);

    INSERT INTO "person" (id, tenant_id, given_name, family_name, email, updated_at)
    VALUES (v_person_id, v_tenant_id, p_admin_given_name, p_admin_family_name, v_admin_email, now());

    INSERT INTO "person_access_role" (person_id, access_role_id, tenant_id)
    VALUES (v_person_id, v_admin_access_role_id, v_tenant_id);

    -- Reuse an existing Account when this human already logs in elsewhere —
    -- the entire point of a tenant-independent credential. `account` carries
    -- no RLS (CLAUDE.md exception 2), so this SELECT sees every tenant's
    -- accounts regardless of who calls this function — exactly the same
    -- cross-tenant read `provisionTenantCore()` already performs on the
    -- owner connection today.
    SELECT a.id INTO v_account_id FROM "account" a WHERE a.email = v_admin_email;
    v_account_reused := v_account_id IS NOT NULL;

    IF NOT v_account_reused THEN
        v_account_id := calendry_internal.uuid_v7()::text;

        INSERT INTO "account" (id, email, password_hash, must_change_password, updated_at)
        VALUES (v_account_id, v_admin_email, p_initial_password_hash, true, now());
    END IF;

    INSERT INTO "account_person" (account_id, person_id) VALUES (v_account_id, v_person_id);

    -- ONE DEFAULT ROW PER LIVE CATALOGUE TYPE, supplied by the caller — see
    -- the defining migration's "catalogues stay in TypeScript" section. The
    -- keys in each JSON object are exactly the columns below, snake_case,
    -- chosen by server/utils/staffCreateTenant.ts when it serialises
    -- DEFAULT_CONSTRAINTS.
    INSERT INTO "constraint_def" (id, tenant_id, type, name, severity, weight, params, is_enabled, is_default, updated_at)
    SELECT
        calendry_internal.uuid_v7()::text,
        v_tenant_id,
        c.type,
        c.name,
        c.severity::"constraint_severity",
        c.weight,
        COALESCE(c.params, '{}'::jsonb),
        c.is_enabled,
        true,
        now()
    FROM jsonb_to_recordset(p_default_constraints) AS c(
        type text, name text, severity text, weight int, params jsonb, is_enabled boolean
    );

    RETURN QUERY
    SELECT v_tenant_id, p_slug, p_name, v_person_id, v_admin_email, v_account_id, v_account_reused, v_lecturer_role_id;
END;
$fn$;
