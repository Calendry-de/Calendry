/**
 * Every permission the schedule page actually needs.
 *
 * WHY THIS IS A LIST AND NOT JUST `session.read`
 *
 * `/schedule` draws a week grid, and to draw one it needs the Term (for dates
 * and week count), the TimeGrid (for block geometry), and the Groups, Rooms and
 * People that a Session's chips and pickers name. Those arrive as one
 * `Promise.all` of five reference fetches, each behind its OWN read permission.
 *
 * The page used to be gated on nothing at all, so a role holding only
 * `session.read` — which sounds exactly like "may view the schedule" — reached
 * it, one fetch 403'd, the whole wave rejected, and the page rendered NOTHING.
 * Blank: not an error, not a partial view, and indistinguishable from a tenant
 * that has not been set up yet.
 *
 * WHY GATING RATHER THAN TOLERATING EACH FETCH
 *
 * Degrading each fetch to an empty list keeps the page up, but a schedule with
 * no TimeGrid renders "No time grid configured" — which is a LIE to someone
 * whose tenant has one and who simply may not read it. A permission problem
 * that renders as a configuration problem sends the reader to fix the wrong
 * thing. Better to say plainly which permission is missing.
 *
 * `session_kind.read` is deliberately NOT here. Kinds feed the Event editor's
 * kind picker, not the grid, so that fetch stays individually tolerant: a role
 * that cannot read kinds can still see the schedule, and simply is not offered
 * a kind picker.
 */
export const SCHEDULE_PERMISSIONS = [
    'session.read',
    'term.read',
    'time_grid.read',
    'group.read',
    'room.read',
    'person.read',
] as const;

/** Which of the required permissions the caller is missing. Empty means allowed. */
export function missingSchedulePermissions(held: Iterable<string>): string[] {
    const set = new Set(held);

    return SCHEDULE_PERMISSIONS.filter((permission) => !set.has(permission));
}
