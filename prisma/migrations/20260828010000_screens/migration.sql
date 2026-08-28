SET search_path = public;

-- ---------------------------------------------------------------------------
-- Screens: a lobby display is a DEVICE, not a person
-- ---------------------------------------------------------------------------
--
-- A screen in a corridor shows what is happening in the rooms around it. It has
-- no user, cannot be asked to log in, and must keep working when nobody has
-- touched it for a term.
--
-- WHY THIS IS NOT A FOURTH RLS EXCEPTION, which is the thing that would have
-- made it a bad idea. The obvious build is a public unauthenticated read —
-- which would mean either dropping RLS on the tables a board reads, or a policy
-- that answers with no tenant context. Instead a Screen is a CREDENTIAL, with
-- exactly the access shape the auth plane already uses (CLAUDE.md exception 2):
-- resolved only by the unique hash of a secret it presents, never by a tenant
-- filter, through a SECURITY DEFINER function taking the secret alone. Once that
-- returns a tenant, every subsequent read happens inside an ordinary
-- `withTenant()` transaction under the same RLS as any other request.
--
-- So this table IS tenant-scoped and RLS-protected like everything else; only
-- the initial resolution is privileged, and it is privileged in the one way that
-- is already established.
--
-- A Screen holds NO AccessRole and no acting Person, which is what makes the
-- authority question answer itself: `heldPermissions()` throws 403 the moment
-- `actorPersonId` is null, so a screen credential cannot satisfy any permission
-- check anywhere in the app, now or after someone adds a new one. Its authority
-- is exactly its room scope and nothing else.
-- ---------------------------------------------------------------------------
CREATE TABLE "screen" (
    "id"        TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,

    -- What a human calls it when revoking the right one: "Main entrance",
    -- "B-block corridor".
    "name" TEXT NOT NULL,

    -- SHA-256 of the presented key, never the key itself — the same treatment
    -- `auth_session` gives its token, for the same reason: a leaked database
    -- backup must not hand over working credentials.
    "token_hash" TEXT NOT NULL,

    -- Revocation without deletion, so a screen taken down for a week does not
    -- lose its name and room scope.
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    -- Last successful board fetch. The only way to answer "is that display in
    -- the east corridor actually still working?" without walking there.
    "last_seen_at" TIMESTAMPTZ(3),

    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

    CONSTRAINT "screen_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "screen"
    ADD CONSTRAINT "screen_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- GLOBALLY unique, not per-tenant: the hash is looked up before any tenant is
-- known, so a collision across tenants would resolve to whichever row came
-- first. Unique here makes that unrepresentable rather than unlikely.
CREATE UNIQUE INDEX "screen_token_hash_key" ON "screen" ("token_hash");
CREATE INDEX "screen_tenant_id_idx" ON "screen" ("tenant_id");

-- ---------------------------------------------------------------------------
-- Which rooms a screen shows. NO ROWS MEANS EVERY ROOM.
-- ---------------------------------------------------------------------------
--
-- Fail-open, matching `group_term` and `group_term_availability`, and for the
-- same reason: a screen created without a scope should show the building rather
-- than a blank wall, which is what a fail-closed reading would produce and which
-- looks identical to a broken display.
--
-- Note this widens nothing. The scope narrows what a screen may see WITHIN its
-- tenant; the tenant boundary is RLS, as always.
-- ---------------------------------------------------------------------------
CREATE TABLE "screen_room" (
    "screen_id" TEXT NOT NULL,
    "room_id"   TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,

    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

    CONSTRAINT "screen_room_pkey" PRIMARY KEY ("screen_id", "room_id")
);

ALTER TABLE "screen_room"
    ADD CONSTRAINT "screen_room_screen_id_fkey"
    FOREIGN KEY ("screen_id") REFERENCES "screen"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "screen_room"
    ADD CONSTRAINT "screen_room_room_id_fkey"
    FOREIGN KEY ("room_id") REFERENCES "room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "screen_room"
    ADD CONSTRAINT "screen_room_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "screen_room_room_id_idx" ON "screen_room" ("room_id");
CREATE INDEX "screen_room_tenant_id_idx" ON "screen_room" ("tenant_id");

-- Both tenant-scoped and isolated at the DB layer like everything else.
ALTER TABLE "screen" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "screen" FORCE ROW LEVEL SECURITY;
ALTER TABLE "screen_room" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "screen_room" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "screen"
    USING (tenant_id = calendry_internal.current_tenant_id())
    WITH CHECK (tenant_id = calendry_internal.current_tenant_id());

CREATE POLICY tenant_isolation ON "screen_room"
    USING (tenant_id = calendry_internal.current_tenant_id())
    WITH CHECK (tenant_id = calendry_internal.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "screen" TO calendry_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "screen_room" TO calendry_app;

-- ---------------------------------------------------------------------------
-- Resolve a screen key to its tenant, before any tenant context exists
-- ---------------------------------------------------------------------------
--
-- Deliberately the same shape as `calendry_internal.session_identity()`:
-- SECURITY DEFINER, STABLE, parameterised by the SECRET ALONE and never by a
-- tenant id, so it cannot be used to enumerate or to cross a boundary — the
-- caller must already hold the secret, and what comes back is only the tenant
-- that secret belongs to.
--
-- Returns the row even when inactive, so the app can answer "revoked" instead of
-- "no such screen". A display showing "this screen has been turned off" is
-- fixable by whoever walks past it; one showing nothing is a hardware call.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION calendry_internal.screen_identity(p_token_hash text)
RETURNS TABLE (
    screen_id     text,
    tenant_id     text,
    federation_id text,
    name          text,
    is_active     boolean,
    room_ids      text[]
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $fn$
    SELECT
        s.id, s.tenant_id, t.federation_id, s.name, s.is_active,
        -- The room scope comes back in the SAME privileged call rather than a
        -- second one, so "what is this credential" is one question with one
        -- answer. A handler cannot act on a screen whose scope it forgot to
        -- load, because there is no way to obtain the screen without it.
        COALESCE(
            (SELECT array_agg(r.room_id ORDER BY r.room_id)
             FROM screen_room r WHERE r.screen_id = s.id),
            ARRAY[]::text[]
        )
    FROM screen s
    JOIN tenant t ON t.id = s.tenant_id
    WHERE s.token_hash = p_token_hash
$fn$;

REVOKE EXECUTE ON FUNCTION calendry_internal.screen_identity(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION calendry_internal.screen_identity(text) TO calendry_app;
