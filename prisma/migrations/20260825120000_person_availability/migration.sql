SET search_path = public;

-- ---------------------------------------------------------------------------
-- Person availability: vetoes (with approval) and soft preferences
-- ---------------------------------------------------------------------------
--
-- WHY THIS EXISTS
--
-- `lecturer_veto` has been a LIVE, enabled, HARD constraint in every tenant
-- since provisioning started creating one default row per catalogue type — and
-- it has never once been able to fire. `Person.blackouts` exists on the wire and
-- the solver implements it (shape 2, unary, slot-keyed), but the app modelled no
-- unavailability at all: `assembleSolverInput` sent `blackouts: []`
-- unconditionally, with a comment saying so.
--
-- So this is not a new capability on the solver side. It is the missing half of
-- one that has been running against an empty set. Nothing in calendry-proto or
-- calendry-solver changes.
--
-- WHY APPROVAL, AND ONLY FOR SELF-DECLARED ROWS
--
-- A veto is HARD. A person who can write one unreviewed can make a term
-- infeasible, and the failure surfaces as unplaced Sessions and ExactFrequency
-- violations with nothing pointing back at the cause. So a self-declared window
-- lands PENDING and is inert until somebody holding `availability.manage_any`
-- approves it.
--
-- An administrator writing one directly is exercising an authority they were
-- granted, so it is written APPROVED with themselves recorded as the decider.
-- Queueing it for approval would mean approving your own authorized action,
-- which is ceremony, not control.
--
-- Deletion needs no approval at any status, because every deletion RELAXES the
-- problem. Approval exists to stop unilateral TIGHTENING.

CREATE TYPE "person_unavailability_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "person_unavailability" (
    "id"        TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,

    -- Mirrors calendry.solver.v1.Unavailability EXACTLY, including its emptiness
    -- convention: an empty array means "every value on that axis". {days:[5]} is
    -- every Friday; {blocks:[0]} is every first block; {} is everything.
    --
    -- NOTE that person_preference below INVERTS this — there an empty array
    -- means "no preference". Two adjacent tables with opposite emptiness
    -- semantics is precisely what a later reader gets wrong, so both say so.
    "days"   INTEGER[] NOT NULL DEFAULT '{}',
    "blocks" INTEGER[] NOT NULL DEFAULT '{}',
    "weeks"  INTEGER[] NOT NULL DEFAULT '{}',

    "reason" TEXT,

    "status" "person_unavailability_status" NOT NULL DEFAULT 'PENDING',

    "created_by_person_id" TEXT,
    "decided_by_person_id" TEXT,
    "decided_at"           TIMESTAMPTZ(3),
    "decision_note"        TEXT,

    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "person_unavailability_pkey" PRIMARY KEY ("id")
);

-- The half-decided state is unrepresentable rather than merely unlikely: a row
-- is either awaiting a decision with no timestamp, or decided with one.
--
-- Written against `decided_at` and NOT against `decided_by_person_id`, which is
-- the part that looks like an oversight and is not. The decider is an audit
-- POINTER and is ON DELETE SET NULL — deleting an administrator must not
-- cascade away the decisions they made, exactly as session_event.session_id may
-- be detached. A CHECK naming the pointer would then either be violated by a
-- legitimate person deletion or force RESTRICT on it. The timestamp is a fact
-- and cannot be detached, so it carries the constraint.
ALTER TABLE "person_unavailability" ADD CONSTRAINT "person_unavailability_decision_complete"
    CHECK (
        (status = 'PENDING'  AND decided_at IS NULL)
        OR
        (status <> 'PENDING' AND decided_at IS NOT NULL)
    );

ALTER TABLE "person_unavailability" ADD CONSTRAINT "person_unavailability_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CASCADE on the subject: their declared unavailability is meaningless without
-- them, and nothing else references it.
ALTER TABLE "person_unavailability" ADD CONSTRAINT "person_unavailability_person_id_fkey"
    FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL on both audit pointers — see the CHECK above.
ALTER TABLE "person_unavailability" ADD CONSTRAINT "person_unavailability_created_by_fkey"
    FOREIGN KEY ("created_by_person_id") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "person_unavailability" ADD CONSTRAINT "person_unavailability_decided_by_fkey"
    FOREIGN KEY ("decided_by_person_id") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "person_unavailability_tenant_id_idx" ON "person_unavailability" ("tenant_id");
-- The review queue's own query.
CREATE INDEX "person_unavailability_tenant_id_status_idx" ON "person_unavailability" ("tenant_id", "status");
-- The solver read path: approved rows for a set of people.
CREATE INDEX "person_unavailability_person_id_status_idx" ON "person_unavailability" ("person_id", "status");

-- ---------------------------------------------------------------------------

CREATE TABLE "person_preference" (
    -- The person IS the key. One row per Person by construction, not by a
    -- unique index that could be dropped without anything noticing.
    "person_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,

    -- EMPTY MEANS NO PREFERENCE — the opposite of person_unavailability above,
    -- where empty means every value.
    "preferred_days"   INTEGER[] NOT NULL DEFAULT '{}',
    "preferred_blocks" INTEGER[] NOT NULL DEFAULT '{}',

    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "person_preference_pkey" PRIMARY KEY ("person_id")
);

ALTER TABLE "person_preference" ADD CONSTRAINT "person_preference_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "person_preference" ADD CONSTRAINT "person_preference_person_id_fkey"
    FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "person_preference_tenant_id_idx" ON "person_preference" ("tenant_id");

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
--
-- Ordinary tenant isolation, identical to every other tenant-scoped table. NO
-- new RLS exception, and specifically NOT a row-level "own person only" policy.
--
-- Self-scoping is authorization WITHIN a tenant, which has always been the
-- application layer's job here — `requirePermission` is a query, not a policy.
-- Expressing "may write only their own row" in RLS would need a second
-- conditional isolation dimension (a calendry.person_id GUC set on some requests
-- and not others) so the database could tell an administrator editing anyone
-- from a person editing themselves. CLAUDE.md permits exactly four
-- RLS-bypassing/widening paths and requires a comparably strong reason for a
-- fifth; "the route could also have enforced this" is not one.
--
-- What enforces self-scoping instead is route SHAPE: /api/me/* takes no person
-- id, from the URL or the body, so another Person's row is unnameable rather
-- than merely rejected.

ALTER TABLE "person_unavailability" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "person_unavailability" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "person_unavailability"
    USING (tenant_id = calendry_internal.current_tenant_id())
    WITH CHECK (tenant_id = calendry_internal.current_tenant_id());

ALTER TABLE "person_preference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "person_preference" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "person_preference"
    USING (tenant_id = calendry_internal.current_tenant_id())
    WITH CHECK (tenant_id = calendry_internal.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "person_unavailability" TO calendry_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "person_preference" TO calendry_app;
