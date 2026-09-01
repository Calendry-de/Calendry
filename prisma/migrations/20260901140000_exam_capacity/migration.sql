-- ---------------------------------------------------------------------------
-- exam_capacity: a separate, optional capacity for exam sittings (issue #102)
-- ---------------------------------------------------------------------------
--
-- Room.capacity is a teaching-time seat count. Exam spacing and invigilation
-- reduce how many of those seats are usable during a sitting, so a room needs
-- a second, SMALLER number that only applies to exams.
--
-- NULLABLE, NO DEFAULT — matches `Offering.color`/`Offering.requiredCapacity`'s
-- "NULL is a meaningful fallback" pattern: an unset `exam_capacity` means
-- "use this room's normal `capacity`", not "this room holds zero people for
-- an exam".
-- ---------------------------------------------------------------------------

ALTER TABLE "room" ADD COLUMN "exam_capacity" integer;
