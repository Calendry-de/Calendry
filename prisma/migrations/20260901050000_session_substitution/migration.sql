-- ===========================================================================
-- Substitutions / Vertretungen (issue #30): "somebody else covers a Session
-- someone cannot teach", as an overlay on ONE occurrence rather than an edit
-- to the Offering's own assignment. See the model's doc comment in
-- schema.prisma for why this is keyed 1:1 by session_id with no date range.
-- ===========================================================================
ALTER TYPE "session_event_type" ADD VALUE IF NOT EXISTS 'SUBSTITUTE';

CREATE TABLE "session_substitution" (
    "id"                 TEXT NOT NULL,
    "tenant_id"          TEXT NOT NULL,
    "session_id"         TEXT NOT NULL,
    "covering_person_id" TEXT NOT NULL,
    "reason"             TEXT,

    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "session_substitution_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "session_substitution" ADD CONSTRAINT "session_substitution_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "session_substitution" ADD CONSTRAINT "session_substitution_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "session_substitution" ADD CONSTRAINT "session_substitution_covering_person_id_fkey"
    FOREIGN KEY ("covering_person_id") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one ACTIVE substitute per Session — matches the Prisma model's 1:1.
CREATE UNIQUE INDEX "session_substitution_session_id_key" ON "session_substitution" ("session_id");

CREATE INDEX "session_substitution_tenant_id_idx" ON "session_substitution" ("tenant_id");
CREATE INDEX "session_substitution_covering_person_id_idx" ON "session_substitution" ("covering_person_id");

ALTER TABLE "session_substitution" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "session_substitution" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "session_substitution"
    USING (tenant_id = calendry_internal.current_tenant_id())
    WITH CHECK (tenant_id = calendry_internal.current_tenant_id());

-- The blanket GRANT in the init migration applied only to tables existing at
-- that time (see its own comment at the `group_source` table above it).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "session_substitution" TO calendry_app;
