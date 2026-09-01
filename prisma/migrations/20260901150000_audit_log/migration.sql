-- ---------------------------------------------------------------------------
-- audit_log: a persisted trail for permission changes, login attempts, and
-- denied cross-tenant access (issue #78)
-- ---------------------------------------------------------------------------
--
-- NO RLS, deliberately — same family of exception as `account`/`auth_session`/
-- `account_person` (CLAUDE.md, exception 2), for a related but distinct
-- reason: a denied CROSS-TENANT attempt is by definition about more than one
-- tenant, so this table must be writable and (for cross-tenant auditing)
-- readable without any single tenant's RLS context ever applying to it.
--
-- NO FOREIGN KEYS to account/person/tenant. The actor or the tenant an event
-- names may be deleted long after the event happened, and the audit row must
-- remain legible when that happens — `actor_label` denormalizes a
-- human-readable name/email at write time instead. Writes go through
-- `server/utils/auditLog.ts` on the base Prisma client, the same
-- "read/write without withTenant()" pattern `server/utils/authDb.ts` already
-- uses for the pre-tenant plane.
-- ---------------------------------------------------------------------------

CREATE TYPE "audit_outcome" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');

CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,

    -- Free-form event key, e.g. "login.success", "access.denied_cross_tenant".
    -- Not the fixed Permission catalogue — this names an EVENT, not a
    -- grantable capability.
    "action" TEXT NOT NULL,

    "outcome" "audit_outcome" NOT NULL,

    "actor_person_id"  TEXT,
    "actor_account_id" TEXT,
    -- Denormalized human-readable actor, captured at write time so the row
    -- stays legible after the Person/Account it names is deleted.
    "actor_label" TEXT,

    -- What was acted on — free text; sometimes absent (a bare login attempt
    -- names no target beyond the actor).
    "target" TEXT,

    -- The tenant this event belongs to, or — for a denied cross-tenant
    -- attempt — the tenant that was DENIED, never the actor's own. Null for
    -- an event that predates tenant selection (e.g. an early login failure).
    "tenant_id" TEXT,

    -- Action-specific context: e.g. a permission set before/after, or the
    -- permission key a denied check required.
    "detail" JSONB NOT NULL DEFAULT '{}',

    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_log_tenant_id_idx" ON "audit_log" ("tenant_id");
CREATE INDEX "audit_log_action_idx" ON "audit_log" ("action");
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" ("created_at");

-- No ENABLE/FORCE ROW LEVEL SECURITY and no tenant_isolation policy — see the
-- header comment. calendry_app needs SELECT (cross-tenant audit reads) and
-- INSERT (every write); no UPDATE/DELETE, matching the append-only contract
-- `server/utils/auditLog.ts` enforces in code.
GRANT SELECT, INSERT ON TABLE "audit_log" TO calendry_app;
