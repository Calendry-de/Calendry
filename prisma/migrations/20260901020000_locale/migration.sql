-- ===========================================================================
-- Locale-aware date formatting (issue #17): the three-tier resolution
-- (Person.locale > TenantDisplaySettings.defaultLocale > Accept-Language).
-- No new tables — both columns are plain, nullable additions to tables
-- whose RLS/grants already cover them.
-- ===========================================================================
ALTER TABLE "person" ADD COLUMN "locale" TEXT;

ALTER TABLE "tenant_display_settings" ADD COLUMN "default_locale" TEXT;
