-- ---------------------------------------------------------------------------
-- offering_group gains a per-Group lecturer pin (issue #131)
-- ---------------------------------------------------------------------------
--
-- A real run was refused outright: an Offering created from a curriculum-plan
-- template (issue #129) named two lecturers, required_lecturer_count derived
-- to 1 of 2 -- a genuine pool -- and the tenant's HARD lecturer_veto covered
-- its kind. The solver cannot precompute an individual's veto mask for a pool
-- Offering, because WHICH calendar to check is a decision the search itself
-- makes, so convert.rs refuses the whole run rather than build a silently
-- wrong mask.
--
-- The school's own answer is not "pick for me": each cohort has ITS teacher
-- (a Klassenlehrer). That is a fact about one series of the Offering, so it
-- lives on the series row: offering_group.lecturer_person_id. NULL keeps the
-- series on the Offering-wide pool, exactly as before; set, it narrows that
-- series' wire candidates to the one person, which is the wire's own "fixed
-- assignment" shape and needs no proto or solver change.
--
-- Deliberately NOT a composite foreign key onto offering_lecturer, although
-- the pin is meant to name a pool member: the pool is a PUT-set replaced by
-- delete-then-insert in a separate request (server/api/[resource]/[id]/
-- [relation].put.ts), so ON DELETE CASCADE would wipe every pin on every
-- roster save and ON DELETE SET NULL would do the same one step later, even
-- when the pinned person stays in the pool. Membership is checked where the
-- two are read together, in assembleSolverInput, which reports a pin outside
-- the pool and falls back to the pool for that series; the relation writes
-- warn. Same reasoning as offering.required_lecturer_count carrying no CHECK
-- against the pool.

ALTER TABLE "offering_group" ADD COLUMN "lecturer_person_id" TEXT;

-- SET NULL, not CASCADE: deleting the person clears the pin and the series
-- falls back to the pool. It must not detach the Group from the Offering.
ALTER TABLE "offering_group"
    ADD CONSTRAINT "offering_group_lecturer_person_id_fkey"
    FOREIGN KEY ("lecturer_person_id") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "offering_group_lecturer_person_id_idx" ON "offering_group" ("lecturer_person_id");

-- No RLS change: offering_group is already tenant-isolated (it is in the
-- squashed migration's tenant_scoped list), and a column inherits its table's
-- policies.
