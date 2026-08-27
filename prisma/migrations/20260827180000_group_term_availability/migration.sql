SET search_path = public;

-- ---------------------------------------------------------------------------
-- When a Group is available WITHIN a Term
-- ---------------------------------------------------------------------------
--
-- Some cohorts run the first half of a Term and some the second — a block
-- placement, a late intake, a programme that alternates. Until now that was
-- inexpressible: a Group was either in a Term or not, and every Session
-- attached to it could be placed in any of that Term's weeks.
--
-- ABSENT ROW MEANS THE WHOLE TERM. Fail-open, matching `group_term`'s own
-- choice and for the same reason: scoping is opt-in, so every existing Group
-- keeps working and a newly created one is immediately usable rather than
-- unschedulable until someone remembers a second step. This migration therefore
-- needs no backfill and changes no behaviour for any existing row.
--
-- WHY NOT COLUMNS ON `group_term`, WHICH IS THE OBVIOUS PLACE
--
-- Because `group_term`'s row EXISTENCE already carries meaning, and it is the
-- opposite kind of meaning. No row there means "available in every Term"; a row
-- means "only these Terms". Putting a date range on that table would make
-- setting a range for a Group with no rows create one — silently scoping that
-- Group OUT of every other Term as a side effect of saying when it is busy in
-- this one. A separate table has no such coupling.
--
-- It also keeps intact the standing rule that `group_term` is a VISIBILITY
-- scope and never a scheduling input (see CLAUDE.md). This table is the
-- opposite: it exists precisely to reach the solver.
--
-- ONE WINDOW PER (GROUP, TERM), by primary key rather than by constraint, so a
-- second window is unrepresentable rather than merely rejected. Same shape as
-- `tenant_display_settings` being keyed by `tenant_id` alone. `Unavailability`
-- on the wire could carry several disjoint windows, so this is a deliberate
-- narrowing of what the schema can say, not a limit of what the solver can
-- honour: "available from X to Y" is the request, and a Group away for a
-- fortnight in the middle of a range is a different feature with a different UI.
-- ---------------------------------------------------------------------------
CREATE TABLE "group_term_availability" (
    "group_id"  TEXT NOT NULL,
    "term_id"   TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,

    -- Both NULLABLE and at least one required (see the CHECK below). One-sided
    -- is a real request — "joins in week 5, runs to the end" — and forcing a
    -- caller to restate the Term's own boundary would store a second copy of it
    -- that goes stale the moment the Term moves.
    "available_from" DATE,
    "available_to"   DATE,

    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

    CONSTRAINT "group_term_availability_pkey" PRIMARY KEY ("group_id", "term_id")
);

-- CASCADE on both, and for the reason `person_unavailability.term_id` uses it: a
-- window whose Term or Group is gone is silently inert, which is the exact
-- failure this feature exists to prevent. RESTRICT would instead make a Term
-- undeletable because somebody once narrowed a cohort inside it.
ALTER TABLE "group_term_availability"
    ADD CONSTRAINT "group_term_availability_group_id_fkey"
    FOREIGN KEY ("group_id") REFERENCES "group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "group_term_availability"
    ADD CONSTRAINT "group_term_availability_term_id_fkey"
    FOREIGN KEY ("term_id") REFERENCES "term"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "group_term_availability"
    ADD CONSTRAINT "group_term_availability_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A row with neither bound says exactly what an ABSENT row says, and two
-- representations of one state is the thing this codebase deletes rows to
-- avoid (`person_preference` deletes when both axes empty, for the same
-- reason). Unrepresentable rather than discouraged.
ALTER TABLE "group_term_availability"
    ADD CONSTRAINT "group_term_availability_needs_a_bound"
    CHECK (available_from IS NOT NULL OR available_to IS NOT NULL);

-- An inverted range is not a narrow window, it is an empty one — which would
-- blacken every week of the Term and make the Group unschedulable, reported as
-- nothing more specific than "no feasible placement".
ALTER TABLE "group_term_availability"
    ADD CONSTRAINT "group_term_availability_ordered"
    CHECK (
        available_from IS NULL
        OR available_to IS NULL
        OR available_from <= available_to
    );

-- Tenant-scoped, isolated at the DB layer like everything else. The app role
-- owns nothing and runs under FORCE ROW LEVEL SECURITY.
ALTER TABLE "group_term_availability" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "group_term_availability" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "group_term_availability"
    USING (tenant_id = calendry_internal.current_tenant_id())
    WITH CHECK (tenant_id = calendry_internal.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "group_term_availability" TO calendry_app;

-- The solve-time read is "every window for this Term", so the term is the
-- leading column of the access path the group_id-first primary key cannot
-- serve.
CREATE INDEX "group_term_availability_term_id_idx" ON "group_term_availability" ("term_id");
CREATE INDEX "group_term_availability_tenant_id_idx" ON "group_term_availability" ("tenant_id");
