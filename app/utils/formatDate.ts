const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A stored instant as a calendar date, read in UTC.
 *
 * Deliberately NOT `toLocaleDateString`. Two hazards it avoids:
 * `toLocaleDateString(undefined, …)` resolves the SERVER's locale during SSR and
 * the BROWSER's on hydration, which is a mismatch whenever the two differ; and
 * reading the day through the local timezone means a server in one zone and a
 * reader in another can disagree about which DAY something happened on. Reading
 * the UTC parts gives one answer everywhere.
 *
 * Lifted out of `pages/schedule/proposals.vue`, which had the only copy. A
 * second copy on the availability pages would have been two places for one
 * subtle rule to drift — and the drift would be invisible, because both would
 * keep rendering a plausible date.
 *
 * This is display shape, not translation: the app is English and the month names
 * are literals. Swap for `Intl` with an EXPLICIT locale (never `undefined`) if
 * that changes.
 */
export function formatDate(iso: string): string {
    const date = new Date(iso);

    if (Number.isNaN(date.getTime())) {
        return 'date unknown';
    }

    return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
