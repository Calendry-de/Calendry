-- Deleting a Tenant was impossible once it had ever produced a Generation.
--
-- WHAT FAILED, AND WHERE IT ACTUALLY FAILED
--
-- `generation` and `session_event` both carry an ON DELETE CASCADE FK to
-- `tenant`, so removing a Tenant emits a DELETE against each. Both tables are
-- guarded by `calendry_internal.deny_mutation()`, which refused every DELETE
-- unconditionally — so the cascade could not fire and the parent DELETE aborted:
--
--     ERROR: generation is append-only; DELETE is not permitted
--     CONTEXT: SQL statement "DELETE FROM ONLY "public"."generation"
--                             WHERE $1 OPERATOR(pg_catalog.=) "tenant_id""
--
-- Note WHICH trigger raised: `generation_no_delete`, not
-- `session_event_append_only`. The generation cascade is reached first, so
-- exempting only `session_event` — the obvious reading, and what the tracked
-- entry said — would have moved the error rather than fixed it. Both share the
-- one function, so both are fixed by one change.
--
-- It went unnoticed because nothing in the application deletes a Tenant: there
-- is no `/api/tenants` at all. The only callers are operator cleanup and the
-- integration suite, and the suite had absorbed it as a workaround —
-- `tests/helpers/seed.ts` DISABLES all three append-only triggers around its
-- teardown. A workaround in the fixture is how a schema defect survives a
-- thousand passing tests.
--
-- THE DISCRIMINATOR, AND WHY IT MATCHES EXACTLY
--
-- A cascade is permitted; a direct DELETE is not. The two are told apart by
-- whether the owning Tenant still exists: the parent row is removed before its
-- FK cascade fires, so during a cascade `OLD.tenant_id` no longer resolves,
-- while a hand-written `DELETE FROM generation WHERE id = ...` runs with the
-- Tenant very much present and is still refused.
--
-- That is an exact match rather than a broad allowance, which is the property
-- CLAUDE.md's "guards must fail loudly or match exactly" rule asks for: there is
-- no state in which this branch both "correctly permits a cascade" and "permits
-- something else because of a bug". Both columns are `NOT NULL`, so the check
-- cannot be satisfied by an absent tenant_id.
--
-- WHAT IS STILL REFUSED
--
--   * DELETE of a `generation` or `session_event` whose Tenant exists — the
--     append-only invariant of TAXONOMY.md §3, unchanged.
--   * Every UPDATE to `session_event` except the existing narrow detach
--     (session_id / counterpart_session_id set to NULL and nothing else).
--   * Every UPDATE to a `generation`'s content, via the separate
--     `generation_content_immutable` trigger, which this does not touch.
--
-- Erasing a Tenant erases its audit trail, which is the point of erasing a
-- Tenant. The alternative — a Tenant that can never be removed — is not a
-- stronger audit guarantee, only an undeletable row.

CREATE OR REPLACE FUNCTION calendry_internal.deny_mutation() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    -- OLD with exactly the two FK columns NEW claims, and nothing else changed.
    -- If NEW still differs from this, some other column was touched.
    detached public.session_event;
BEGIN
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'session_event' THEN
        detached := OLD;
        detached.session_id := NEW.session_id;
        detached.counterpart_session_id := NEW.counterpart_session_id;

        IF NEW IS NOT DISTINCT FROM detached
           -- Neither column may be REPOINTED; only cleared.
           AND (NEW.session_id IS NULL OR NEW.session_id = OLD.session_id)
           AND (NEW.counterpart_session_id IS NULL
                OR NEW.counterpart_session_id = OLD.counterpart_session_id)
           -- And at least one of them must actually be a detach, so a no-op
           -- UPDATE is still refused rather than quietly accepted.
           AND ((OLD.session_id IS NOT NULL AND NEW.session_id IS NULL)
                OR (OLD.counterpart_session_id IS NOT NULL
                    AND NEW.counterpart_session_id IS NULL))
        THEN
            RETURN NEW;
        END IF;
    END IF;

    -- A DELETE that is a CASCADE from the owning Tenant. See the header: the
    -- parent row is already gone by the time its cascade fires, and a direct
    -- DELETE is not, so this permits exactly the one case and nothing adjacent.
    IF TG_OP = 'DELETE'
       AND NOT EXISTS (SELECT 1 FROM public.tenant WHERE id = OLD.tenant_id)
    THEN
        RETURN OLD;
    END IF;

    RAISE EXCEPTION
        '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'restrict_violation';
END $$;

-- ---------------------------------------------------------------------------
-- The same defect on `generation`, and this one is USER-FACING
-- ---------------------------------------------------------------------------
--
-- `generation.created_by_id` is `ON DELETE SET NULL`, and
-- `generation_content_immutable` lists `created_by_id` among the columns that
-- may never change. So the FK action the schema depends on was refused by a
-- trigger on the same table — the third instance of that exact shape, after the
-- `session_event` detach (20260816180000) and the cascades above:
--
--     ERROR: generation <id> is immutable: only status, is_current, applied_at
--            and infeasibility_report may change
--     CONTEXT: SQL statement "UPDATE ONLY "public"."generation"
--                             SET "created_by_id" = NULL WHERE ..."
--
-- Unlike the Tenant case this is reachable from the UI. `/manage/persons`
-- offers delete behind `person.delete`, so removing a departed member of staff
-- who had ever triggered a solver run or applied a Generation failed with a raw
-- database error. Verified against a real row before fixing.
--
-- The exemption is the narrow one, modelled on the `session_event` detach: an
-- UPDATE that nulls `created_by_id` AND CHANGES NOTHING ELSE. Repointing it at
-- a different Person is still refused, and so is nulling it alongside any other
-- edit — a cascade only ever touches that one column, so anything wider is not
-- a cascade. The authorship record degrades to "unknown" rather than becoming a
-- lie, which is what deleting the Person actually means.
--
-- The alternatives are worse in the usual two directions: RESTRICT would make a
-- Person who once ran the solver permanently undeletable, and CASCADE would
-- delete the Generation — a timetable — because somebody left.

CREATE OR REPLACE FUNCTION calendry_internal.generation_content_immutable() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    -- OLD with exactly the one FK column NEW claims, and nothing else changed.
    detached public.generation;
BEGIN
    detached := OLD;
    detached.created_by_id := NEW.created_by_id;

    IF NEW IS NOT DISTINCT FROM detached
       -- Only ever CLEARED, never repointed, and it must actually be a detach
       -- so a no-op cannot slip through this branch.
       AND OLD.created_by_id IS NOT NULL
       AND NEW.created_by_id IS NULL
    THEN
        RETURN NEW;
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.version IS DISTINCT FROM OLD.version
       OR NEW.parent_generation_id IS DISTINCT FROM OLD.parent_generation_id
       OR NEW.source IS DISTINCT FROM OLD.source
       OR NEW.solver_meta IS DISTINCT FROM OLD.solver_meta
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by_id IS DISTINCT FROM OLD.created_by_id
    THEN
        RAISE EXCEPTION
            'generation % is immutable: only status, is_current, applied_at and infeasibility_report may change',
            OLD.id
            USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN NEW;
END $$;
