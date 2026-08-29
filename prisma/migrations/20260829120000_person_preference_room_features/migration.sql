SET search_path = public;

-- ---------------------------------------------------------------------------
-- Which room types a Person would rather teach in
-- ---------------------------------------------------------------------------
--
-- The second axis of `person_preference`, after the day/block one. A lecturer
-- who works better in a lab, or who would rather not be put in the big raked
-- lecture theatre, has had nowhere to say so.
--
-- The wire carries `Preference.preferred_room_features` as a repeated STRING,
-- matched against `Room.feature_tags`' vocabulary by key — so the assembly maps
-- `equipment_id` to `equipment.key` at the boundary, exactly as
-- `room_equipment` and `offering_equipment` already do.
--
-- WHY A TABLE AND NOT A `TEXT[]` COLUMN ON `person_preference`
--
-- Storing keys inline would mirror `preferred_days`/`preferred_blocks`, which
-- sit on that row as arrays — but those are plain scalars with no entity behind
-- them, so there is nothing for them to reference. Equipment IS an entity, and
-- every other reference to it in this schema is an `equipment_id` with a
-- foreign key. A key array would be the single place that is not, and the
-- failure it buys is the silent kind: renaming an Equipment's key would void
-- every person's preference for it, leaving an inert string that no constraint,
-- no query and no report would ever contradict. The FK below cannot be renamed
-- out from under a preference, and a deleted Equipment takes its preferences
-- with it rather than leaving them pointing nowhere.
--
-- ABSENT ROWS MEAN NO PREFERENCE, the same convention the two array columns
-- already use — empty is "no opinion", never "prefers nothing". So this
-- migration needs no backfill and changes no behaviour for any existing row.
--
-- ON `person_preference` AND NOT ON `person`: the parent row already carries
-- `weight_multiplier`, which is how much this person's preferences count. A
-- room preference without that multiplier would be a preference the tenant
-- cannot weigh, so it belongs to the same row's lifetime — including its
-- deletion, which is why the FK below cascades from the preference and not
-- from the Person.
-- ---------------------------------------------------------------------------
CREATE TABLE "person_preference_room_feature" (
    "person_id"    TEXT NOT NULL,
    "equipment_id" TEXT NOT NULL,
    "tenant_id"    TEXT NOT NULL,

    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

    CONSTRAINT "person_preference_room_feature_pkey" PRIMARY KEY ("person_id", "equipment_id")
);

-- CASCADE from the preference row, so `person_preference`'s existing
-- delete-when-empty discipline keeps working: a caller clearing every axis
-- deletes the parent and these go with it, rather than leaving orphan rows that
-- would make an absent preference and an empty one two different states again.
ALTER TABLE "person_preference_room_feature"
    ADD CONSTRAINT "person_preference_room_feature_person_id_fkey"
    FOREIGN KEY ("person_id") REFERENCES "person_preference"("person_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CASCADE, not RESTRICT: an Equipment nobody offers any more should be
-- deletable, and a preference for it is inert the moment no Room carries it.
-- RESTRICT would make retiring a tag impossible because one lecturer once
-- ticked it.
ALTER TABLE "person_preference_room_feature"
    ADD CONSTRAINT "person_preference_room_feature_equipment_id_fkey"
    FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "person_preference_room_feature"
    ADD CONSTRAINT "person_preference_room_feature_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "person_preference_room_feature" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "person_preference_room_feature" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "person_preference_room_feature"
    USING (tenant_id = calendry_internal.current_tenant_id())
    WITH CHECK (tenant_id = calendry_internal.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "person_preference_room_feature" TO calendry_app;

-- The solve-time read is "every preference in this tenant", joined to equipment
-- for the key; the person_id-first primary key serves the per-person read.
CREATE INDEX "person_preference_room_feature_tenant_id_idx" ON "person_preference_room_feature" ("tenant_id");
CREATE INDEX "person_preference_room_feature_equipment_id_idx" ON "person_preference_room_feature" ("equipment_id");
