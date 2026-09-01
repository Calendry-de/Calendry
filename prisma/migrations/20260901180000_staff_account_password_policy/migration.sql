-- ---------------------------------------------------------------------------
-- staff_account password aging / forced reset — issue #106
-- ---------------------------------------------------------------------------
--
-- `account` (the tenant credential) already has `must_change_password` and
-- `password_changed_at` (`20260901100000_init`), driving the operator-forced
-- reset and the `MAX_PASSWORD_AGE_MS` expiry check in `server/utils/auth.ts`.
-- `staff_account` — the highest-privilege credential in the system — had
-- neither, so an operator had no way to force a stale or compromised staff
-- password to be changed, and staff passwords never expired at all.
--
-- SAME COLUMN SHAPE AS `account`, deliberately: `NOT NULL DEFAULT` on both,
-- no nullable-then-backfill dance, because this table is new enough (issue
-- #76, one migration ago) that there is no pre-existing-rows concern the
-- `account` table's own history had to work around.
-- ---------------------------------------------------------------------------
ALTER TABLE "staff_account" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "staff_account" ADD COLUMN "password_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now();
