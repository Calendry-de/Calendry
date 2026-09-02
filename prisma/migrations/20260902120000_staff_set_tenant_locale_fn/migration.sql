-- ---------------------------------------------------------------------------
-- calendry_internal.staff_set_tenant_locale() — a Tenant's default locale,
-- set from the staff panel
-- ---------------------------------------------------------------------------
--
-- SAME TECHNIQUE as `calendry_internal.staff_create_tenant()` (issue #105),
-- `staff_create_federation()` / `staff_set_tenant_federation()` (issue #64)
-- and `staff_erase_tenant()` (issue #84): a narrow, parameterized
-- SECURITY DEFINER function, callable through the ORDINARY `calendry_app`
-- runtime role. See the header carried over from
-- `20260901170000_staff_create_tenant_fn` (above, in the squashed init
-- migration) for the full argument against `getOwnerPrisma()`; it applies
-- here unchanged, and this is the FIRST staff WRITE added since that argument
-- was made, so following it rather than reopening it is the whole point.
--
-- WHY A FUNCTION AT ALL, when a tenant admin writes this exact column with
-- an ordinary Prisma upsert (`PUT /api/display-settings`). Because a staff
-- session is never IN a tenant: `tenant_display_settings` carries
-- `ENABLE`/`FORCE ROW LEVEL SECURITY` with a `tenant_id =
-- calendry_internal.current_tenant_id()` policy, and `StaffIdentity` cannot
-- even be passed to `withTenant()` (a compile error, deliberately — see
-- `server/utils/tenantDb.ts` and CLAUDE.md's fourth tenant-isolation
-- exception). With no tenant context open, `current_tenant_id()` is NULL and
-- the ordinary connection sees zero rows and can write none. This is NOT a
-- sixth isolation exception: it is exception 4 using the mechanism exception
-- 4 already uses.
--
-- UPSERT, BECAUSE THE ROW IS A SINGLETON WHOSE ABSENCE MEANS DEFAULTS.
-- `tenant_display_settings` is keyed by `tenant_id` alone (no `id` column, so
-- a second row is unrepresentable) and provisioning deliberately seeds none,
-- so setting a locale on a tenant that has never opened the display page must
-- CREATE the row rather than fail. `ON CONFLICT ON CONSTRAINT` names the
-- primary key rather than the column: inside PL/pgSQL, `tenant_id` is also
-- the name of one of this function's own OUT parameters, and naming the
-- constraint keeps the conflict target out of that collision entirely
-- (`staff_erase_tenant()` solved the same collision by table-qualifying every
-- column reference).
--
-- CLEARING A DEFAULT THAT WAS NEVER SET INSERTS NOTHING. `p_locale => NULL`
-- means "no tenant default, defer to Accept-Language", which is exactly what
-- an ABSENT row already says. Inserting one to store that would flip the
-- singleton into existence and stamp every other display setting with its
-- default for an operator who asked to change none of them — the same hazard
-- `PUT /api/display-settings` avoids by skipping its upsert when a request
-- touches only `timezone` (see that route's own comment). The `configured`
-- column of the result reports which of the two happened, so the caller
-- never has to guess.
--
-- THE LOCALE IS NOT VALIDATED HERE. `isUsableLocale()` (`shared/locale.ts`)
-- validates a BCP-47 tag by round-tripping it through `Intl.DateTimeFormat`,
-- which PL/pgSQL has no equivalent of; the write boundary
-- (`PATCH /api/staff/tenants/:id/locale`, and `PUT /api/display-settings`
-- before it) refuses an unusable tag, exactly as `staff_create_tenant()`
-- leaves password hashing to its caller for the same "SQL has no primitive
-- for this" reason. This function trusts a validated value.
--
-- ERROR SURFACE. An unknown tenant id raises plpgsql's standard
-- `no_data_found` (P0002), the same condition every sibling raises for an
-- unresolvable id; `server/utils/staffTenantLocale.ts` maps it to
-- `UnknownTenantIdError` and the route to a 404.
--
-- ATOMICITY needs no explicit transaction: a single statement invoking a
-- function is already atomic. Same note as the siblings.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION calendry_internal.staff_set_tenant_locale(
    p_tenant_id text,
    p_locale    text
)
RETURNS TABLE (
    tenant_id      text,
    tenant_slug    text,
    default_locale text,
    configured     boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, calendry_internal, pg_temp
AS $fn$
DECLARE
    v_slug   text;
    v_exists boolean;
BEGIN
    SELECT t.slug INTO v_slug FROM "tenant" t WHERE t.id = p_tenant_id;

    IF v_slug IS NULL THEN
        RAISE EXCEPTION 'No tenant with id ''%''.', p_tenant_id
            USING ERRCODE = 'no_data_found';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM "tenant_display_settings" s WHERE s.tenant_id = p_tenant_id
    ) INTO v_exists;

    -- Nothing to clear, and nothing worth creating to record that. See the
    -- file header.
    IF p_locale IS NULL AND NOT v_exists THEN
        RETURN QUERY SELECT p_tenant_id, v_slug, NULL::text, false;
        RETURN;
    END IF;

    INSERT INTO "tenant_display_settings" (tenant_id, default_locale, updated_at)
    VALUES (p_tenant_id, p_locale, now())
    ON CONFLICT ON CONSTRAINT "tenant_display_settings_pkey"
    DO UPDATE SET default_locale = EXCLUDED.default_locale, updated_at = now();

    -- Read BACK rather than echoing `p_locale`: the result then reports what
    -- the table holds, not what the caller asked for.
    RETURN QUERY
    SELECT p_tenant_id, v_slug, s.default_locale, true
    FROM "tenant_display_settings" s
    WHERE s.tenant_id = p_tenant_id;
END;
$fn$;

REVOKE ALL ON FUNCTION calendry_internal.staff_set_tenant_locale(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION calendry_internal.staff_set_tenant_locale(text, text) TO calendry_app;
