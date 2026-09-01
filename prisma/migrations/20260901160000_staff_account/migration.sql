-- ---------------------------------------------------------------------------
-- staff_account / staff_session — issue #76, the FOURTH tenant-isolation
-- exception (CLAUDE.md "The deliberate exceptions to tenant isolation";
-- DECISIONS.md "Staff principal — the fourth tenant-isolation exception")
-- ---------------------------------------------------------------------------
--
-- Calendry's own staff (onboarding, support) need a credential that is not
-- scoped to any tenant at all — not even the federation-widened read the
-- first exception grants. A flag on `account` was rejected: every `account`
-- row is reachable only via `account_person` -> `person.tenant_id`, and a
-- staff principal acts as no Person in any tenant, so there is nothing in
-- that graph to hang a flag off without making every account query ask "or
-- is this staff" forever. A separate credential, separate cookie
-- (`STAFF_SESSION_COOKIE` in server/utils/auth.ts), separate tables.
--
-- NO RLS, matching `account`/`auth_session` (exception 2) for the identical
-- reason: these tables carry no `tenant_id` and never will — access is by
-- verified credential, never a tenant filter.
--
-- UNLIKE `auth_session`, this needs no `calendry_internal.*_identity()`
-- SECURITY DEFINER function: that indirection exists only where a pre-tenant
-- lookup must JOIN into an RLS-protected table (`person`, `tenant`) to learn
-- which tenant a session belongs to (see `session_identity()`, above). A
-- staff session joins to nothing but its own staff_account, so an ordinary
-- query on the runtime connection is the whole story — no fourth privileged
-- path, just a second table pair with the same access shape as the first.
-- ---------------------------------------------------------------------------
CREATE TABLE "staff_account" (
    "id"            TEXT NOT NULL,
    "email"         TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_active"     BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at"    TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "updated_at"    TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

    CONSTRAINT "staff_account_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "staff_account_email_key" ON "staff_account" ("email");

CREATE TABLE "staff_session" (
    "id"               TEXT NOT NULL,
    "staff_account_id" TEXT NOT NULL,
    "token_hash"       TEXT NOT NULL,
    "expires_at"       TIMESTAMPTZ(3) NOT NULL,
    "revoked_at"       TIMESTAMPTZ(3),
    "created_at"       TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "user_agent"       TEXT,
    "ip_address"       TEXT,

    CONSTRAINT "staff_session_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "staff_session"
    ADD CONSTRAINT "staff_session_staff_account_id_fkey"
    FOREIGN KEY ("staff_account_id") REFERENCES "staff_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "staff_session_token_hash_key" ON "staff_session" ("token_hash");
CREATE INDEX "staff_session_staff_account_id_idx" ON "staff_session" ("staff_account_id");

-- NO RLS — see the header comment. The blanket GRANT in the init migration
-- (20260812000100, concatenated into 20260901100000_init) applied only to
-- tables existing at that time, so this pair, like every table added since,
-- grants explicitly.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "staff_account" TO calendry_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "staff_session" TO calendry_app;
