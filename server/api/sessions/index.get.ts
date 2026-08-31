import { z } from 'zod';
import { conflictGroupIds } from '../../utils/groupClosure';
import { sessionReadScope } from '../../utils/scheduleScope';
import { withRequestTenant } from '../../utils/tenantDb';

const querySchema = z.object({
    termId: z.string().optional(),
    termWeek: z.coerce.number().int().optional(),
    groupId: z.string().optional(),
    roomId: z.string().optional(),
    personId: z.string().optional(),
    offeringId: z.string().optional(),
    isLocked: z.coerce.boolean().optional(),
    includeNested: z.coerce.boolean().optional(),
    /**
     * The spare bank (issue #22): a banked Session has no `termWeek`, so a
     * week-scoped fetch never matches it. Explicit rather than inferred from
     * an absent `termWeek` — see the `where` assembly below for why this is
     * ALSO the only way in, not merely the way to widen past a week filter.
     */
    banked: z.coerce.boolean().optional(),
});

/**
 * Current schedule state.
 *
 * Reads the materialized `session` table directly rather than replaying the
 * event log. Sessions ARE current state — editing routes write them in the same
 * transaction that appends the event — so replaying on every read would be
 * O(events) per request for an answer already stored. The log exists for audit
 * and rollback, which is a separate (future) endpoint.
 *
 * TWO PERMISSIONS REACH THIS. `session.read` returns the institution's whole
 * timetable; `session.read_own` returns the caller's own sessions. The narrowing
 * is `sessionReadScope()`'s, not this handler's, because `GET
 * /api/schedule/context` has to agree with it exactly — it publishes names for
 * whatever this returns, so a second definition of "own" would either strand a
 * chip without a name or name a room in a session the caller may not read.
 *
 * THE QUERY FILTERS COMPOSE WITH THE SCOPE, never replace it: a `read_own`
 * caller passing `personId=<somebody else>` intersects their own set with that
 * person's and gets the sessions they share, which is exactly right and is not a
 * special case anywhere below.
 */
export default defineEventHandler(async (event) => {
    const query = await getValidatedQuery(event, querySchema.parse);

    return withRequestTenant(event, async (tx, identity) => {
        /*
         * Refuses a caller holding neither key, and otherwise hands back the
         * ownership predicate — tenant-owned plus Federation-shared, because a
         * shared event must appear on every member tenant's timetable (Stage 7c)
         * and RLS permits that read without ever asking for it — already
         * narrowed to the caller's own sessions when that is all they may see.
         */
        const { where } = await sessionReadScope(event, tx, identity);

        if (query.termId) where.termId = query.termId;

        /**
         * DEFAULT EXCLUDES THE SPARE BANK (issue #22) — not merely "absent
         * unless a week filter happens to match". A caller that fetches with
         * no `termWeek` at all (the whole Term) would otherwise see a banked
         * Session's null placement flow straight into rendering code that has
         * always assumed one, exactly the failure this route exists to
         * prevent for every OTHER caller of this endpoint the day one is
         * added. `banked=true` is the one, explicit way in; it overrides
         * `termWeek` rather than composing with it, since "week 3, banked" is
         * an empty result nobody intended and the spare bank is not scoped to
         * any one week.
         */
        if (query.banked) {
            where.termWeek = null;
        } else {
            where.termWeek = query.termWeek !== undefined ? query.termWeek : { not: null };
        }

        if (query.offeringId) where.offeringId = query.offeringId;
        if (query.isLocked !== undefined) where.isLocked = query.isLocked;

        if (query.groupId) {
            // Filtering by a Cohort should surface its Seminars' sessions too, so
            // includeNested resolves through the closure rather than matching only
            // directly assigned groups.
            const groupIds = query.includeNested
                ? await conflictGroupIds(tx, [query.groupId])
                : [query.groupId];

            where.groups = { some: { groupId: { in: groupIds } } };
        }

        if (query.roomId) where.rooms = { some: { roomId: query.roomId } };
        if (query.personId) where.people = { some: { personId: query.personId } };

        return tx.session.findMany({
            where,
            orderBy: [{ termWeek: 'asc' }, { dayOfWeek: 'asc' }, { blockIndex: 'asc' }],
            include: {
                groups: { select: { groupId: true } },
                // The role KEY travels with the session, not just its id.
                // `Lecturer` is the one fixed role name (TAXONOMY.md §2), and
                // splitting lecturers out of the attendee list needs to know
                // which assignment is which.
                //
                // Sent from HERE rather than fetched by the client from
                // /api/roles, which needs `role.read` — a permission the
                // `viewer` role does not hold. A reference fetch the page's own
                // gate does not cover is what blanked the 6c review screen: one
                // 403 inside a Promise.all rejects the whole handler.
                people: {
                    select: { personId: true, roleId: true, role: { select: { key: true } } },
                },
                rooms: { select: { roomId: true } },
                // A Session's own columns carry no human-readable label, so a
                // client would otherwise need a second round trip per view just
                // to name what it is drawing. Both are read-only and already
                // tenant-scoped by the same transaction.
                offering: { select: { id: true, title: true, code: true, color: true } },
                kind: { select: { id: true, key: true, name: true, color: true } },
            },
        });
    });
});
