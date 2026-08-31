-- ===========================================================================
-- SolverInputSnapshot (issue #24): the full SolverInput a run actually sent,
-- not just its hash. Keyed by solver_run_id, not generation_id — see the
-- model's own doc comment in schema.prisma for why. A dedicated table so the
-- largest, most sensitive payload the app stores never bloats the hot
-- solver_run table.
-- ===========================================================================
CREATE TABLE "solver_input_snapshot" (
    "id"              TEXT NOT NULL,
    "tenant_id"       TEXT NOT NULL,
    "solver_run_id"   TEXT NOT NULL,
    -- gzip over SolverInput.encode(input).finish() — the same bytes
    -- solver_run.input_hash is a digest of, never a JSON rendering.
    "compressed_input" BYTEA NOT NULL,

    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solver_input_snapshot_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "solver_input_snapshot" ADD CONSTRAINT "solver_input_snapshot_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "solver_input_snapshot" ADD CONSTRAINT "solver_input_snapshot_solver_run_id_fkey"
    FOREIGN KEY ("solver_run_id") REFERENCES "solver_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One snapshot per run, matching the 1:1 the Prisma model declares.
CREATE UNIQUE INDEX "solver_input_snapshot_solver_run_id_key" ON "solver_input_snapshot" ("solver_run_id");

CREATE INDEX "solver_input_snapshot_tenant_id_idx" ON "solver_input_snapshot" ("tenant_id");

ALTER TABLE "solver_input_snapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "solver_input_snapshot" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "solver_input_snapshot"
    USING (tenant_id = calendry_internal.current_tenant_id())
    WITH CHECK (tenant_id = calendry_internal.current_tenant_id());

-- The blanket GRANT in the init migration applied only to tables existing at
-- that time (see its own comment at the `group_source` table above it).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "solver_input_snapshot" TO calendry_app;
