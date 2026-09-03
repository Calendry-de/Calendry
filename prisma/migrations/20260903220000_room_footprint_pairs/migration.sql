-- ---------------------------------------------------------------------------
-- room_footprint: a shared physical footprint is a PAIR of Rooms, not a tag
-- (issue #122, reworked)
-- ---------------------------------------------------------------------------
--
-- 20260903210000_room_footprint_tags stored free text on each Room and asked
-- the operator to invent a tag per shared wall and type it onto every Room
-- involved. That raised a question the model could only answer in prose:
-- "which room carries the tag, the hall or the parts?" (both), and got it
-- wrong silently when the answer was half-typed: a tag on one Room is inert.
--
-- This table stores the relationship itself: (room, other_room) means the two
-- are one physical space. It is SYMMETRIC BY TRIGGER, not by convention: every
-- insert writes its mirror, every delete removes it, so the set reads complete
-- from either Room and the management form can edit it from either side. The
-- wire is unchanged: toWireRoom derives one footprint tag per pair, carried by
-- exactly its two Rooms, so the solver's non-transitive expansion is preserved
-- (the hall pairs with each part; the parts do not pair with each other).
--
-- Ownership follows room_equipment exactly: tenant_id is NULL for a pair
-- written on a federation-owned Room, reads widen to the federation through
-- the Room, writes stay tenant-only.

CREATE TABLE "room_footprint" (
    "room_id"       TEXT NOT NULL,
    "other_room_id" TEXT NOT NULL,
    "tenant_id"     TEXT,

    CONSTRAINT "room_footprint_pkey" PRIMARY KEY ("room_id", "other_room_id"),
    -- A room is trivially the same space as itself; storing that would make
    -- the derived tag block the room against its own bookings.
    CONSTRAINT "room_footprint_not_self" CHECK ("room_id" <> "other_room_id")
);

CREATE INDEX "room_footprint_other_room_id_idx" ON "room_footprint"("other_room_id");
CREATE INDEX "room_footprint_tenant_id_idx" ON "room_footprint"("tenant_id");

ALTER TABLE "room_footprint" ADD CONSTRAINT "room_footprint_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "room_footprint" ADD CONSTRAINT "room_footprint_room_id_fkey"
    FOREIGN KEY ("room_id") REFERENCES "room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "room_footprint" ADD CONSTRAINT "room_footprint_other_room_id_fkey"
    FOREIGN KEY ("other_room_id") REFERENCES "room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Backfill from the tags, BEFORE the triggers and RLS exist: two Rooms that
-- shared any tag become a pair in both directions (the join produces (a,b)
-- and (b,a) itself). A tag only one Room carried produces nothing, which is
-- exactly what it did on the wire.
-- ---------------------------------------------------------------------------

INSERT INTO "room_footprint" ("room_id", "other_room_id", "tenant_id")
SELECT a.id, b.id, a.tenant_id
  FROM "room" a
  JOIN "room" b
    ON a.id <> b.id
   AND a.footprint_tags && b.footprint_tags
ON CONFLICT DO NOTHING;

ALTER TABLE "room" DROP CONSTRAINT "room_virtual_has_no_footprint";
ALTER TABLE "room" DROP COLUMN "footprint_tags";

-- ---------------------------------------------------------------------------
-- Symmetry by trigger. AFTER, row-level, guarded by pg_trigger_depth() so the
-- mirror's own firing does not recurse: the mirror of a mirror is the row
-- that caused it. ON CONFLICT DO NOTHING on the insert side makes writing a
-- pair the operator already has from the other end a no-op rather than an
-- error, which is what lets the generic PUT-set route (delete all of one
-- Room's rows, insert the new set) stay ignorant of the mirroring.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION calendry_internal.room_footprint_mirror() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    IF pg_trigger_depth() > 1 THEN
        RETURN NULL;
    END IF;

    IF TG_OP = 'INSERT' THEN
        INSERT INTO "room_footprint" ("room_id", "other_room_id", "tenant_id")
        VALUES (NEW.other_room_id, NEW.room_id, NEW.tenant_id)
        ON CONFLICT DO NOTHING;
    ELSIF TG_OP = 'DELETE' THEN
        DELETE FROM "room_footprint"
         WHERE "room_id" = OLD.other_room_id
           AND "other_room_id" = OLD.room_id;
    END IF;

    RETURN NULL;
END;
$$;

CREATE TRIGGER room_footprint_mirror
    AFTER INSERT OR DELETE ON "room_footprint"
    FOR EACH ROW EXECUTE FUNCTION calendry_internal.room_footprint_mirror();

-- ---------------------------------------------------------------------------
-- A virtual Room has no physical footprint. The old column's CHECK could say
-- so on one table; the relationship spans two, so the same invariant is a
-- trigger on each: no pair may name a virtual Room, and no paired Room may
-- become virtual. The routes refuse both first, with a field the form can
-- point at (server/utils/resources.ts, relations.ts); these are the backstop
-- for a write that bypasses them, raised as a check violation so mapDbErrors
-- answers 422 rather than 500.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION calendry_internal.room_footprint_refuse_virtual() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "room" r
         WHERE r.id IN (NEW.room_id, NEW.other_room_id)
           AND r.is_virtual
    ) THEN
        RAISE EXCEPTION 'a virtual room has no physical footprint'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'room_virtual_has_no_footprint';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER room_footprint_refuse_virtual
    BEFORE INSERT ON "room_footprint"
    FOR EACH ROW EXECUTE FUNCTION calendry_internal.room_footprint_refuse_virtual();

CREATE OR REPLACE FUNCTION calendry_internal.room_refuse_virtual_with_footprint() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.is_virtual AND NOT OLD.is_virtual AND EXISTS (
        SELECT 1 FROM "room_footprint" f WHERE f.room_id = NEW.id
    ) THEN
        RAISE EXCEPTION 'a virtual room has no physical footprint'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'room_virtual_has_no_footprint';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER room_refuse_virtual_with_footprint
    BEFORE UPDATE OF "is_virtual" ON "room"
    FOR EACH ROW EXECUTE FUNCTION calendry_internal.room_refuse_virtual_with_footprint();

-- ---------------------------------------------------------------------------
-- RLS, room_equipment's shape: the pair inherits its Room's ownership.
-- ---------------------------------------------------------------------------

ALTER TABLE "room_footprint" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "room_footprint" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_or_federation_read ON "room_footprint" FOR SELECT
    USING (
        tenant_id = calendry_internal.current_tenant_id()
        OR EXISTS (
            SELECT 1 FROM "room" r
            WHERE r.id = "room_footprint".room_id
              AND r.federation_id = calendry_internal.current_federation_id()
        )
    );

CREATE POLICY tenant_write ON "room_footprint" FOR ALL
    USING (tenant_id = calendry_internal.current_tenant_id())
    WITH CHECK (tenant_id = calendry_internal.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "room_footprint" TO calendry_app;

-- The blanket GRANT in the init migration applied to functions existing at
-- that time, so the trigger functions are granted explicitly, as every later
-- function is.
GRANT EXECUTE ON FUNCTION calendry_internal.room_footprint_mirror() TO calendry_app;
GRANT EXECUTE ON FUNCTION calendry_internal.room_footprint_refuse_virtual() TO calendry_app;
GRANT EXECUTE ON FUNCTION calendry_internal.room_refuse_virtual_with_footprint() TO calendry_app;
