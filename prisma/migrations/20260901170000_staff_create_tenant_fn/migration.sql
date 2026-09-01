-- ---------------------------------------------------------------------------
-- calendry_internal.staff_create_tenant() — issue #105
-- ---------------------------------------------------------------------------
--
-- Replaces the owner-Prisma path `POST /api/staff/tenants` used
-- (`server/utils/ownerPrisma.ts`, issue #76) with the SAME technique
-- `calendry_internal.session_identity()` / `screen_identity()` already use:
-- a narrow SECURITY DEFINER function, callable through the ordinary
-- `calendry_app` runtime role, instead of handing the running app a live,
-- cached connection authenticated as the database OWNER.
--
-- WHY THIS WAS NECESSARY, NOT JUST TIDIER
--
-- `getOwnerPrisma()` gave every request that reaches `requireStaffIdentity()`
-- a standing owner connection: no RLS, no FORCE ROW LEVEL SECURITY, able to
-- read or write across every tenant. `scripts/provision-tenant.ts`'s own
-- header comment already argues against exactly this for the CLI — a
-- compromised web tier holding owner credentials is a strictly worse failure
-- mode than one holding `calendry_app` credentials, because the database
-- itself, not just application code, is what stood between a bug in
-- `requireStaffIdentity()` and every institution's data. A SECURITY DEFINER
-- function narrows that to one specific, auditable operation: `calendry_app`
-- gains the ability to run THIS insert sequence and nothing else, the same
-- deal `session_identity()` already makes for reading across the pre-tenant
-- boundary.
--
-- WHY A FUNCTION CAN DO WHAT calendry_app COULD NOT
--
-- `tenant`'s RLS write policy is `id = calendry_internal.current_tenant_id()`
-- (see the RLS migration), unsatisfiable for a row that does not exist yet —
-- `scripts/provision-tenant.ts`'s header comment covers this in full. A
-- SECURITY DEFINER function executes with the privileges of its OWNER (the
-- migration role, which `SELECT rolsuper FROM pg_roles` confirms is a
-- superuser and therefore bypasses RLS outright, `FORCE ROW LEVEL SECURITY`
-- included), regardless of which role calls it. `calendry_app` gets to
-- invoke that privilege for exactly this sequence of inserts; it gains no
-- broader ability to bypass RLS anywhere else.
--
-- WHAT STAYS ON THE APP SIDE, AND WHY
--
-- Password hashing does not move into SQL. `hashPassword()`
-- (server/utils/auth.ts) is `scrypt`, chosen for its tunable memory-hardness —
-- PL/pgSQL has no scrypt primitive, and `pgcrypto`'s `crypt()` only offers
-- bcrypt/md5/des, which would mean every OTHER account in this database
-- (created via `scripts/provision-tenant.ts` or `POST /api/accounts`, both of
-- which call the same Node-side `hashPassword()`) uses a different hashing
-- scheme than one created here. The route hashes the initial password on the
-- ordinary `calendry_app` connection, same as it always could — hashing
-- itself touches no protected row — and passes only the resulting hash in.
-- Everything that is an actual privileged WRITE (the Tenant row itself, its
-- Roles/AccessRoles, the admin Person, the Account/AccountPerson link, the
-- default Constraint rows) happens INSIDE this function, not split across a
-- pre- or post-call on a separate connection.
--
-- ATOMICITY
--
-- No explicit transaction wraps the call from the app side (deliberately —
-- see server/utils/staffCreateTenant.ts). A single statement invoking a
-- function is already atomic: PostgreSQL rolls back everything the function
-- did if it raises partway through, the same guarantee
-- `getOwnerPrisma().$transaction(...)` gave, without needing a second
-- connection or an explicit BEGIN/COMMIT the caller has to get right.
--
-- CATALOGUES STAY IN TYPESCRIPT
--
-- The permission catalogue (`shared/permissions.ts`) and the constraint-type
-- catalogue (`shared/constraintTypes.ts`, via `defaultConstraintRow`) are NOT
-- reproduced here — CLAUDE.md is explicit that permissions are fixed, code,
-- not schema, and duplicating either catalogue into SQL would create a
-- second copy that silently drifts from the one `prisma/seed.ts` and the
-- constraint builder already read. The caller passes the resolved
-- permission-key list and default-constraint rows in as plain data
-- (`p_permission_keys`, `p_default_constraints`); this function only knows
-- how to INSERT rows shaped like that, never which rows those should be.
--
-- ERROR SURFACE
--
-- Two failures need to reach the HTTP layer distinguishably, and both are
-- raised as STANDARD PostgreSQL conditions rather than invented codes, the
-- same choice the append-only triggers made (`check_violation`,
-- `restrict_violation` — see the RLS/event-sourcing migrations):
--   * A duplicate slug hits `tenant_slug_key` and raises the ordinary
--     `unique_violation` (23505) — no explicit RAISE needed.
--   * An unknown `federationSlug` raises `no_data_found` (P0002), plpgsql's
--     standard condition for "the referenced row does not exist".
-- Verified empirically (not assumed) that both surface through
-- `$queryRaw`/`$executeRaw` as `PrismaClientKnownRequestError` with
-- `code: 'P2010'` and the original SQLSTATE at
-- `error.meta.driverAdapterError.cause.code` —
-- `server/utils/staffCreateTenant.ts`'s `rawPostgresErrorCode()` is the one
-- place that reads that path.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- calendry_internal.uuid_v7() — a plain value generator, not a privileged
-- lookup. Every `id` column here is TEXT with NO database-side default
-- (`prisma.schema`'s `@default(uuid(7))` is implemented in the Prisma client,
-- not the database — verified against the DDL: `"id" TEXT NOT NULL` with no
-- DEFAULT clause anywhere `uuid(7)` is declared). A function running as the
-- database OWNER cannot ask the Prisma client to mint one, so it mints an
-- equivalent id itself: the well-known "overlay a millisecond timestamp onto
-- a v4 UUID's leading 48 bits, then fix up the version/variant nibbles"
-- construction, verified byte-for-byte against this database's existing
-- tenant ids (`01a0****-****-7***-[89ab]***-************`) before use here.
-- No REVOKE/GRANT pair, unlike the identity-lookup functions below: it reads
-- and touches no protected table, so there is nothing to narrow.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION calendry_internal.uuid_v7() RETURNS uuid
    LANGUAGE sql
    VOLATILE
    PARALLEL SAFE
    AS $$
    SELECT encode(
        set_bit(
            set_bit(
                overlay(uuid_send(gen_random_uuid()) placing
                    substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
                    FROM 1 FOR 6),
                52, 1),
            53, 1),
        'hex')::uuid
$$;

-- ---------------------------------------------------------------------------
-- The privileged function itself. See the file header for the full argument.
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
            -- Standard condition, not an invented code — see the file header.
            -- server/utils/staffCreateTenant.ts maps this to the same 400 the
            -- app-level UnknownFederationError used to produce.
            RAISE EXCEPTION 'No federation with slug ''%''. Create it first.', p_federation_slug
                USING ERRCODE = 'no_data_found';
        END IF;
    END IF;

    -- May raise `unique_violation` (23505) on a duplicate slug — deliberately
    -- uncaught here; see the file header's "error surface" section.
    INSERT INTO "tenant" (id, federation_id, slug, name, timezone, updated_at)
    VALUES (v_tenant_id, v_federation_id, p_slug, p_name, COALESCE(p_timezone, 'UTC'), now());

    -- Domain vocabulary: the one fixed universal role (TAXONOMY.md §2).
    INSERT INTO "role" (id, tenant_id, key, name, description, is_system, updated_at)
    VALUES (
        v_lecturer_role_id, v_tenant_id, 'lecturer', 'Lecturer',
        'Leads a Session. The one universal domain role.', true, now()
    );

    INSERT INTO "access_role" (id, tenant_id, key, name, description, is_system, updated_at)
    VALUES (
        v_admin_access_role_id, v_tenant_id, 'tenant-admin', 'Tenant Administrator',
        'Full access to this tenant.', true, now()
    );

    INSERT INTO "access_role_permission" (access_role_id, permission_key, tenant_id)
    SELECT v_admin_access_role_id, key, v_tenant_id FROM unnest(p_permission_keys) AS key;

    -- The default role: everybody's own timetable, and nothing else — see
    -- provisionTenantCore()'s own comment for why it is exactly one
    -- permission and neither `isSystem` nor auto-assigned.
    INSERT INTO "access_role" (id, tenant_id, key, name, description, updated_at)
    VALUES (
        v_member_access_role_id, v_tenant_id, 'member', 'Member',
        'Sees their own timetable. The baseline for everyone at this institution.', now()
    );

    INSERT INTO "access_role_permission" (access_role_id, permission_key, tenant_id)
    VALUES (v_member_access_role_id, 'session.read_own', v_tenant_id);

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
    -- the file header's "catalogues stay in TypeScript" section. The keys in
    -- each JSON object are exactly the columns below, snake_case, chosen by
    -- server/utils/staffCreateTenant.ts when it serialises DEFAULT_CONSTRAINTS.
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

-- Not executable by the world; only the runtime role may call it — same
-- pattern as `session_identity()` / `screen_identity()` above it in history.
REVOKE ALL ON FUNCTION calendry_internal.staff_create_tenant(
    text, text, text, text, text, text, text, text[], jsonb, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION calendry_internal.staff_create_tenant(
    text, text, text, text, text, text, text, text[], jsonb, text
) TO calendry_app;
