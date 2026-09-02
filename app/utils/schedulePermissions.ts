import type { PermissionRequirement } from '#shared/permissions';
import { satisfiesPermissionRequirement } from '#shared/permissions';

/**
 * What the schedule page actually needs: EITHER read key, and nothing else.
 *
 * WHAT THIS USED TO BE, AND WHY IT STOPPED
 *
 * A list of six: `session.read`, `term.read`, `time_grid.read`, `group.read`,
 * `room.read`, `person.read`. Not arbitrary: the page assembled its own
 * reference data from five CRUD endpoints, each behind its own permission, in
 * one `Promise.all`, and a single 403 rejected the whole wave and rendered a
 * BLANK page. Twice, in two disguises. Gating on all six turned that blank page
 * into a stated denial, which was the right fix for the symptom.
 *
 * It was the wrong shape for the product. It meant the smallest role that could
 * look at a timetable held the authority to query the entire staff directory,
 * every room and every cohort, so "let a lecturer see their own timetable" was
 * unexpressible. The cause was never the permissions; it was that DRAWING a
 * schedule and QUERYING the institution were being served by the same endpoints.
 *
 * They are separated now. `GET /api/schedule/context` returns the names for
 * whatever the caller can see, behind the same key that lets them see it, so the
 * page's gate and its data agree BY CONSTRUCTION rather than by this list being
 * kept in sync with a fetch wave nobody re-reads. The directory endpoints still
 * exist, still need their own keys, and feed filters and pickers that are absent
 * without them, which is a visibly different page, not a broken one.
 *
 * SO THIS FILE IS NOW ONE CLAUSE. Kept as a named export rather than inlined
 * because three places must agree about it (the route middleware, the nav
 * entry, and the API) and the version of this that was three literals is how
 * the link and the route came to disagree in the first place.
 */
export const SCHEDULE_PERMISSIONS: PermissionRequirement = [
    // ONE clause, holding two alternatives: any of these is enough. Not two
    // clauses, which would mean BOTH: see `PermissionRequirement`.
    ['session.read', 'session.read_own'],
];

/** Whether these permissions can open the schedule at all. */
export function canViewSchedule(held: Iterable<string>): boolean {
    return satisfiesPermissionRequirement(new Set(held), SCHEDULE_PERMISSIONS);
}

/**
 * The sentence a denial says.
 *
 * Names BOTH keys, because a tenant admin reading "needs session.read" would
 * grant the whole institution's timetable to somebody who only ever needed their
 * own: the more privileged of the two, chosen by an error message.
 */
export const SCHEDULE_DENIAL = 'You do not have permission to view the schedule. '
    + 'It needs session.read (everyone’s) or session.read_own (your own).';
