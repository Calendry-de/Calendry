SET search_path = public;

-- ---------------------------------------------------------------------------
-- One DEFAULT Constraint row per catalogue type, per tenant
-- ---------------------------------------------------------------------------
--
-- See TAXONOMY.md §2, `Constraint`. A tenant now holds exactly one row per
-- catalogue type, always present and always visible; additional rows of the
-- same type are kind/offering-scoped variants and carry is_default = false.
--
-- WHY THIS EXISTS, AND IT IS NOT A UI CONVENIENCE
--
-- `refreshViolations()` evaluates ONLY the constraint types the tenant has a
-- row for. A type with no row is therefore a SILENTLY DISABLED rule, not a
-- neutral absence — and that is not hypothetical:
--
--   * `provision-tenant.ts` seeded 3 of the 15 catalogue types.
--   * `no_double_booking_person` was added to the catalogue in Stage 7a and
--     never added to provisioning, so NO tenant had a row for it and the
--     person-clash check has never run in any real tenant.
--   * `tests/violations-person-clash.test.ts` passes because it creates its
--     own constraint row, so the gap was invisible from the test suite.
--
-- Guaranteeing the row exists is what makes "enabled" the only thing that
-- decides whether a rule runs.
--
-- WHY A COLUMN AND NOT "the row with no scopes"
--
-- The natural predicate — at most one UNSCOPED row per (tenant, type) — cannot
-- be an index. Scoping lives in the child table `constraint_scope`, and a
-- partial index predicate may only reference columns of the row being indexed.
--
-- A counting trigger was rejected for the reason Stage 2 recorded about
-- `solver_run_one_active_per_term`: two parallel inserts both pass an
-- application-level count and both land. The rule has to be an index, so the
-- fact it indexes has to be a column. This mirrors
-- `generation_one_current_per_tenant`, which is the same shape.
--
-- BACKFILL WITHOUT WRITING ROWS
--
-- Migrations here are schema-only (CLAUDE.md) — they may not INSERT reference
-- or tenant data. Adding the column with DEFAULT true marks every EXISTING row
-- as its type's default, which is correct because no tenant has more than one
-- row per type (verified before writing this). The default is then flipped to
-- false so future inserts — the scoped variants — are not defaults.
--
-- This is DDL, not a data statement: no INSERT, no UPDATE, and the outcome is
-- a property of the ALTER rather than of a row the migration invented.
--
-- If some database DOES hold two rows of one type, the unique index below
-- fails and the migration aborts. That is the intended behaviour: it is a
-- duplicate that needs a human decision about which row survives, and this
-- project prefers a loud stop to a quiet pick.
ALTER TABLE "constraint_def" ADD COLUMN "is_default" boolean NOT NULL DEFAULT true;
ALTER TABLE "constraint_def" ALTER COLUMN "is_default" SET DEFAULT false;

COMMENT ON COLUMN "constraint_def"."is_default" IS
    'True for the tenant''s single always-present row for this catalogue type. '
    'False for kind/offering-scoped variants. See constraint_one_default_per_type.';

CREATE UNIQUE INDEX constraint_one_default_per_type
    ON "constraint_def" (tenant_id, type) WHERE "is_default";
