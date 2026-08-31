-- ===========================================================================
-- Tenant mode (issue #8): school vs university, as a default-behaviour bias.
--
-- A plain column on the existing display singleton, exactly like the locale
-- migration (20260901020000) — no new table, no new RLS, because
-- `tenant_display_settings` already carries both. The ticket that asked for
-- this was explicit that a tenant must not gain a second "settings exist,
-- absent means defaults" mechanism to keep straight alongside this one.
--
-- UNIVERSITY IS THE DEFAULT: every tenant before this column existed got
-- today's Offering form and constraint suggestions, which are what UNIVERSITY
-- now names. NOT NULL with a default, unlike `default_locale`'s NULL-means-
-- absent: there is no third "unset" state a mode bias can mean, so a demoted
-- default row loses nothing this column could have said instead.
--
-- PURELY A UI/UX BIAS. Nothing here changes the Offering or Constraint table,
-- and nothing reads this column to decide what data may be stored — only
-- which fields the Offering form leads with and which constraint types the
-- catalogue suggests first. TAXONOMY.md's fixed entity model does not branch
-- on it.
-- ===========================================================================
CREATE TYPE "tenant_mode" AS ENUM ('UNIVERSITY', 'SCHOOL');

ALTER TABLE "tenant_display_settings"
    ADD COLUMN "mode" "tenant_mode" NOT NULL DEFAULT 'UNIVERSITY';
