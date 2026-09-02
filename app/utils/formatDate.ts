/**
 * A stored instant as a calendar date, read in UTC.
 *
 * `locale` is REQUIRED, never defaulted to `undefined`: passing `undefined`
 * to `Intl.DateTimeFormat` resolves the SERVER's locale during SSR and the
 * BROWSER's on hydration, a mismatch whenever the two differ, which is
 * exactly the hazard this function's own history was written to avoid (it
 * used to hand-format with hardcoded English month names for the same
 * reason). Callers pass `useViewerLocale().value`, the one place that value
 * is resolved, per that composable's own doc comment. `timeZone: 'UTC'` is
 * still load-bearing: reading the day through a local timezone means a
 * server in one zone and a reader in another can disagree about which DAY
 * something happened on.
 *
 * Lifted out of `pages/schedule/proposals.vue`, which had the only copy. A
 * second copy on the availability pages would have been two places for one
 * subtle rule to drift, and the drift would be invisible, because both would
 * keep rendering a plausible date.
 */
export function formatDate(iso: string, locale: string): string {
    const date = new Date(iso);

    if (Number.isNaN(date.getTime())) {
        return 'date unknown';
    }

    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
        .format(date);
}
