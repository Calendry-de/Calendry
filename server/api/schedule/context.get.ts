import { z } from 'zod';
import { getCached } from '../../utils/cache';
import { ancestorGroupIds } from '../../utils/groupClosure';
import { contextCacheKey, SCHEDULE_CACHE_TTL_SECONDS } from '../../utils/scheduleCache';
import { sessionReadScope } from '../../utils/scheduleScope';
import { withRequestTenant } from '../../utils/tenantDb';

/**
 * Everything the schedule needs to DRAW itself, behind the same key that lets
 * you look at it.
 *
 * WHY THIS EXISTS
 * ---------------
 * `/schedule` used to assemble its own reference data from five CRUD endpoints —
 * `/api/terms`, `/api/time-grids`, `/api/groups`, `/api/rooms`, `/api/persons` —
 * each behind its own read permission. So the smallest role that could see a
 * timetable at all needed `term.read`, `time_grid.read`, `group.read`,
 * `room.read` and `person.read`: the authority to query the entire institution's
 * roster, in order to put a lecturer's name on a chip. A lecturer wanting to
 * know which room they are teaching in was being handed the staff directory.
 *
 * It was also the page's most persistent bug: one 403 inside that `Promise.all`
 * rejected the whole wave and the page rendered NOTHING — twice, in two
 * different disguises, which is why `SCHEDULE_PERMISSIONS` existed at all. One
 * endpoint behind the page's own gate removes the class rather than the
 * instances.
 *
 * NAMES FOR WHAT YOU CAN SEE, AND NOTHING ELSE
 * --------------------------------------------
 * The rooms, people and groups here are DERIVED FROM THE VISIBLE SESSIONS, not
 * listed. A `session.read_own` caller therefore learns the name of the room they
 * are booked into and the lecturer leading their lecture, and learns nothing
 * about the rest of the institution — the narrowing is a property of the query
 * rather than a filter someone has to maintain.
 *
 * That is also why `sessionReadScope()` is shared with `GET /api/sessions` and
 * not reimplemented: the two must agree exactly about what "visible" means. A
 * context wider than the session list publishes a name for something the caller
 * cannot read; narrower, and a chip renders a raw uuid.
 *
 * WHAT IS DELIBERATELY *NOT* HERE
 * -------------------------------
 * The full directory. Filter dropdowns and the inspector's pickers need every
 * room, every group and every person — that is querying, not drawing, and it
 * stays behind `room.read` / `group.read` / `person.read`. The page fetches
 * those separately and TOLERANTLY, and simply does not render the controls it
 * has no data for. See `useScheduleData`.
 *
 * `terms` and `timeGrids` ARE complete, because they are the frame rather than
 * the contents: the term picker has to offer every term, and a Term names the
 * grid whose geometry the whole page is drawn on. Neither says anything about a
 * person.
 */
const querySchema = z.object({ termId: z.string().optional() });

defineRouteMeta({
    openAPI: {
        tags: ['Schedule'],
        summary: 'Everything the schedule needs to draw itself',
        description: 'One endpoint behind the same permission that lets you look at the timetable (session.read or session.read_own). terms and timeGrids (with breaks) are complete, because they are the frame. rooms, people and groups are DERIVED FROM THE VISIBLE SESSIONS only: a read_own caller learns the names appearing on their own timetable and nothing else. The full directory stays behind room.read / group.read / person.read on the generic CRUD routes.',
        parameters: [
            { name: 'termId', in: 'query', schema: { type: 'string' }, description: 'Defaults to the most recent term; the resolved id is reported back.' },
        ],
        responses: {
            200: {
                description: 'Reference data for the resolved term.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                scope: { type: 'string', description: 'Whether the caller sees the whole timetable or only their own sessions.' },
                                resolvedTermId: { type: 'string' },
                                terms: { type: 'array', items: { type: 'object' } },
                                timeGrids: { type: 'array', items: { type: 'object' }, description: 'Including breaks; they change what every block is called.' },
                                rooms: { type: 'array', items: { type: 'object' } },
                                people: { type: 'array', items: { type: 'object' } },
                                groups: { type: 'array', items: { type: 'object' }, description: 'Referenced groups plus their ancestors, for disambiguation.' },
                                tenantTimezone: { type: 'string', description: 'IANA zone name. "Today"/"now" for the schedule (the Today button, the live now-indicator) resolve against THIS, never the viewer\'s own zone — timezone is per-Person and display-only (CLAUDE.md).' },
                            },
                        },
                    },
                },
            },
            403: { description: 'Caller holds neither session.read nor session.read_own.' },
        },
    },
});

export default defineEventHandler(async (event) => {
    const query = await getValidatedQuery(event, querySchema.parse);

    return withRequestTenant(event, async (tx, identity) => {
        const { scope, where } = await sessionReadScope(event, tx, identity);

        /*
         * Terms and grids first: the caller needs them even for a term holding
         * no sessions at all, and `termId` is resolved against them by the
         * client exactly as it was before.
         */
        const [terms, timeGrids, tenant] = await Promise.all([
            tx.term.findMany({
                where: { tenantId: identity.tenantId },
                select: { id: true, name: true, startDate: true, endDate: true, timeGridId: true },
                orderBy: { startDate: 'desc' },
            }),
            tx.timeGrid.findMany({
                where: { tenantId: identity.tenantId },
                /*
                 * WITH BREAKS. They change what every block is CALLED, so a grid
                 * without them renders a timetable that is wrong rather than
                 * merely sparse — the same reason `RESOURCES['time-grids']`
                 * includes them.
                 */
                include: { breaks: true },
            }),
            /*
             * THE ONE PLACE THE CLIENT LEARNS THE TENANT'S ZONE. "Today"/"now"
             * on the schedule (the Today button, the live now-indicator) must
             * resolve in `Tenant.timezone`, never the viewer's own — the same
             * rule `localNow` already enforces server-side for
             * `computeReferenceSlot`. Fetched alongside terms/timeGrids, not
             * inside the cached block below: a tenant's timezone changing
             * must not wait out a stale cache entry.
             */
            tx.tenant.findUniqueOrThrow({
                where: { id: identity.tenantId },
                select: { timezone: true },
            }),
        ]);

        /*
         * RESOLVED HERE AND REPORTED BACK, rather than each side defaulting to
         * "the first term". The client fetches its sessions with whatever this
         * says, so the two cannot end up describing different terms — which is
         * how the names below would come to belong to a week nobody is looking
         * at. `startDate: 'desc'` matches `RESOURCES['terms']`, so the default
         * is the same term the old five-fetch wave picked.
         */
        const termId = query.termId || terms[0]?.id || '';

        /**
         * Cache freshness (issue #66): the query above (terms/timeGrids —
         * needed just to resolve `termId`, which the cache key depends on) is
         * deliberately NOT cached and always current. Everything below IS —
         * the whole response is the cached value, terms/timeGrids included,
         * so a cache hit still returns the exact wire shape this route always
         * returned. "Immediately visible after a manual edit" depends on
         * `invalidateScheduleCache()` firing from `appendEvent()`
         * (server/utils/sessionEvents.ts) — the single choke point every
         * write that could change this response passes through. The TTL is a
         * backstop only, in case an invalidation path is ever missed.
         */
        const cacheKey = contextCacheKey({
            tenantId: identity.tenantId,
            termId,
            scope,
            actorPersonId: identity.actorPersonId,
        });

        const cached = await getCached(cacheKey, async () => {
            /*
             * The join rows of the visible sessions, and only those. Selected
             * rather than the sessions themselves: this needs ids to look
             * names up with, and pulling the full rows would be a second copy
             * of a response the client is fetching anyway.
             */
            const visible = await tx.session.findMany({
                where: { ...where, ...(termId ? { termId } : {}) },
                select: {
                    rooms: { select: { roomId: true } },
                    people: { select: { personId: true } },
                    groups: { select: { groupId: true } },
                    // Issue #30: a substitute is never in `people` (their
                    // `session_person` row is deliberately untouched), so without
                    // this the inspector's "Covered by …" would resolve nothing.
                    substitution: { select: { coveringPersonId: true } },
                },
            });

            const roomIds = [...new Set(visible.flatMap((s) => s.rooms.map((r) => r.roomId)))];
            const personIds = [...new Set(visible.flatMap((s) => [
                ...s.people.map((p) => p.personId),
                ...(s.substitution ? [s.substitution.coveringPersonId] : []),
            ]))];
            const referencedGroupIds = [...new Set(visible.flatMap((s) => s.groups.map((g) => g.groupId)))];

            /*
             * ANCESTORS TOO, and this is not a widening. The inspector shows a
             * Group's parent to disambiguate two identically-named seminars, so a
             * Group whose parent is missing renders as an orphan — and the parent is
             * already implied by the child being visible. `ancestorGroupIds` walks
             * UP; `descendantGroupIds` here would publish sibling cohorts the caller
             * has nothing to do with.
             */
            const groupIds = await ancestorGroupIds(tx, referencedGroupIds);

            const [rooms, people, groups] = await Promise.all([
                roomIds.length
                    ? tx.room.findMany({
                        /*
                         * No tenant predicate: the ids came from Sessions this caller
                         * may read, and a federation-shared Session names a
                         * federation-owned Room that `tenantId` would exclude — the
                         * shared lecture hall would lose its name on the one
                         * timetable that most needs it. RLS still applies.
                         */
                        where: { id: { in: roomIds } },
                        select: { id: true, code: true, name: true, isVirtual: true },
                    })
                    : [],
                personIds.length
                    ? tx.person.findMany({
                        where: { id: { in: personIds } },
                        select: { id: true, givenName: true, familyName: true },
                    })
                    : [],
                groupIds.length
                    ? tx.group.findMany({
                        where: { id: { in: groupIds } },
                        select: { id: true, name: true, parentGroupId: true },
                    })
                    : [],
            ]);

            return {
                /*
                 * REPORTED, not inferred. The client renders a different page for
                 * each — no filters, no editor, a heading that says whose timetable
                 * this is — and deriving that from "did the person list come back
                 * empty" would make a tenant with one room look like a restricted
                 * caller.
                 */
                scope,
                resolvedTermId: termId,
                terms,
                timeGrids,
                rooms,
                people,
                groups,
            };
        }, SCHEDULE_CACHE_TTL_SECONDS);

        // OUTSIDE the cached value, deliberately — see this function's own
        // comment above the cache key: a tenant's timezone changing must not
        // wait out a stale cache entry (up to SCHEDULE_CACHE_TTL_SECONDS).
        // `tenant` is fetched fresh on every request, alongside terms/timeGrids.
        return { ...cached, tenantTimezone: tenant.timezone };
    });
});
