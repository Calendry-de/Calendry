-- ---------------------------------------------------------------------------
-- ics_link: a personal calendar-subscription link (issue #15, stream half)
-- ---------------------------------------------------------------------------
--
-- Replaces the toolbar's one-off `.ics` download with a link an external
-- calendar app re-fetches on its own schedule. ALL streams every Term the
-- Person has a Session in, bounded to `weeks_ahead`; TERM streams exactly
-- `term_id`, unbounded (a Term already bounds itself).
--
-- THE SECRET IS STORED PLAIN, unlike `screen`/`api_token`. Deliberately: this
-- is not a one-time bearer credential, it is a capability URL a person must be
-- able to come back and re-copy without losing sync elsewhere by rotating it.
-- It is read-only and scoped to exactly this Person's own Sessions.
--
-- Same technique as `screen`/`api_token`: tenant-scoped and RLS-protected like
-- everything else; only the initial resolution is privileged, through a
-- SECURITY DEFINER function parameterised by the secret alone. NOT a fourth
-- exception to tenant isolation.
-- ---------------------------------------------------------------------------
CREATE TYPE "ics_link_scope" AS ENUM ('ALL', 'TERM');

CREATE TABLE "ics_link" (
    "id"        TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,

    -- What a human calls it when deleting the right one: "Phone", "Outlook".
    "name" TEXT NOT NULL,

    -- The bearer secret itself — see the table comment for why this is not a
    -- hash. Unique GLOBALLY because the lookup happens before any tenant is
    -- known.
    "token" TEXT NOT NULL,

    "scope"       "ics_link_scope" NOT NULL,
    "term_id"     TEXT,
    "weeks_ahead" INTEGER,

    -- Last successful stream fetch, throttled to once a minute — the only way
    -- to tell a link a calendar app still polls from one nobody uses.
    "last_used_at" TIMESTAMPTZ(3),

    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

    CONSTRAINT "ics_link_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ics_link"
    ADD CONSTRAINT "ics_link_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ics_link"
    ADD CONSTRAINT "ics_link_person_id_fkey"
    FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ics_link"
    ADD CONSTRAINT "ics_link_term_id_fkey"
    FOREIGN KEY ("term_id") REFERENCES "term"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- GLOBALLY unique, not per-tenant: the lookup happens before any tenant is
-- known, so a collision across tenants would resolve to whichever row came
-- first. Unique here makes that unrepresentable rather than unlikely.
CREATE UNIQUE INDEX "ics_link_token_key" ON "ics_link" ("token");
CREATE INDEX "ics_link_tenant_id_idx" ON "ics_link" ("tenant_id");
CREATE INDEX "ics_link_person_id_idx" ON "ics_link" ("person_id");

-- Tenant-scoped and isolated at the DB layer like everything else.
ALTER TABLE "ics_link" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ics_link" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "ics_link"
    USING (tenant_id = calendry_internal.current_tenant_id())
    WITH CHECK (tenant_id = calendry_internal.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ics_link" TO calendry_app;

-- ---------------------------------------------------------------------------
-- Resolve an ics_link token to its identity, before any tenant context exists
-- ---------------------------------------------------------------------------
--
-- Same shape as `calendry_internal.screen_identity()`/`api_token_identity()`
-- and for the same reason: SECURITY DEFINER, STABLE, parameterised by the
-- SECRET ALONE and never by a tenant id, so it cannot enumerate or cross a
-- boundary — the caller must already hold the token, and what comes back is
-- only the row it belongs to.
--
-- `person_active` rides along so revocation-by-deactivating-the-person works
-- without a second privileged call, matching `api_token_identity()`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION calendry_internal.ics_link_identity(p_token text)
RETURNS TABLE (
    link_id       text,
    tenant_id     text,
    federation_id text,
    person_id     text,
    person_active boolean,
    scope         "ics_link_scope",
    term_id       text,
    weeks_ahead   integer
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $fn$
    SELECT
        l.id, l.tenant_id, t.federation_id, l.person_id, p.is_active,
        l.scope, l.term_id, l.weeks_ahead
    FROM ics_link l
    JOIN tenant t ON t.id = l.tenant_id
    JOIN person p ON p.id = l.person_id
    WHERE l.token = p_token
$fn$;

REVOKE EXECUTE ON FUNCTION calendry_internal.ics_link_identity(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION calendry_internal.ics_link_identity(text) TO calendry_app;

-- ---------------------------------------------------------------------------
-- Liveness stamp, throttled
-- ---------------------------------------------------------------------------
--
-- Privileged for the same reason `touch_api_token()` is: it runs at
-- resolution time, before any tenant context is set, and a plain UPDATE from
-- `calendry_app` there matches zero rows under FORCE ROW LEVEL SECURITY.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION calendry_internal.touch_ics_link(p_link_id text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
VOLATILE
SET search_path = public, pg_temp
AS $fn$
    UPDATE ics_link
    SET last_used_at = now()
    WHERE id = p_link_id
      AND (last_used_at IS NULL OR last_used_at < now() - interval '60 seconds')
$fn$;

REVOKE EXECUTE ON FUNCTION calendry_internal.touch_ics_link(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION calendry_internal.touch_ics_link(text) TO calendry_app;
