-- ---------------------------------------------------------------------------
-- screen.plan_start_minute / plan_end_minute (issue #131)
-- ---------------------------------------------------------------------------
--
-- The room plan's own day window, in minutes since TENANT-local midnight, so a
-- lobby display can be told to draw 08:00-16:00 and spend its whole height on
-- the hours that carry something.
--
-- Additive and NULLABLE, with NULL meaning "the timetable's own day" (first
-- block start / last block end for the weekday being drawn). That is what
-- every screen already on a wall keeps, so there is no backfill: unlike a
-- Permission or Constraint row, nothing seeds `screen` and the default is the
-- behaviour that shipped before this column existed.
--
-- The two ends are INDEPENDENT (either alone is meaningful: "start at seven,
-- end wherever the timetable does"), so the CHECK constrains each into a
-- calendar day and only orders them when both are set. It fails loudly rather
-- than clamping: a window with its ends crossed is a configuration mistake
-- somebody must see, and a display that quietly drew a different day than the
-- one it was told to is the invisible failure this codebase keeps naming.

ALTER TABLE "screen" ADD COLUMN "plan_start_minute" INTEGER;
ALTER TABLE "screen" ADD COLUMN "plan_end_minute" INTEGER;

ALTER TABLE "screen"
    ADD CONSTRAINT "screen_plan_window_sane" CHECK (
        ("plan_start_minute" IS NULL OR ("plan_start_minute" >= 0 AND "plan_start_minute" <= 1440))
        AND ("plan_end_minute" IS NULL OR ("plan_end_minute" >= 0 AND "plan_end_minute" <= 1440))
        AND (
            "plan_start_minute" IS NULL
            OR "plan_end_minute" IS NULL
            OR "plan_start_minute" < "plan_end_minute"
        )
    );
