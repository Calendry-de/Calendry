import { SCREEN_MODE_PATHS } from '../../../shared/screenKey';
import { LECTURER_ROLE_KEY } from '../../../shared/roles';
import { blockSpan } from '../../../shared/timeGrid';
import { isoWeekday, weekIndexOf } from '../../../shared/academicCalendar';
import { isPlacedSession } from '../../../shared/sessionPlacement';
import { getCached } from '../../utils/cache';
import { boardCacheKey, SCHEDULE_CACHE_TTL_SECONDS } from '../../utils/scheduleCache';
import type { TenantLocalNow } from '../../utils/solverCalendar';
import { localNow } from '../../utils/solverCalendar';
import type { Tx } from '../../utils/tenantDb';
import { withRequestTenant } from '../../utils/tenantDb';
import { resolveScreenKey } from '../../utils/authDb';

/**
 * What a lobby display shows: today, by ROOM.
 *
 * ROOM-CENTRIC, and that is the whole reason this is a route rather than a
 * query parameter on the schedule. Every existing view answers "when is this
 * group/person busy"; somebody standing in a corridor is asking the transposed
 * question: "what is happening in the rooms around me, and is this one free
 * right now". The grid cannot be reshaped into that answer by filtering.
 *
 * AUTHORITY IS THE KEY, NOT A PERMISSION. A screen resolves to a
 * `ScreenIdentity` whose `actorPersonId` is null, so `requirePermission()` would
 * throw 403 for it no matter which permission were named. That is deliberate: a
 * display holds no role and must never be able to acquire one. Its authority is
 * its room scope, and this route is the only thing that reads it.
 *
 * A SIGNED-IN HUMAN MAY ALSO CALL IT, gated on `session.read`, so the management
 * UI can preview a screen before anybody mounts it on a wall. That is the same
 * "two callers, different purposes" shape as `GET /api/display-settings`.
 */
defineRouteMeta({
    openAPI: {
        tags: ['Screens'],
        summary: "Today's room occupancy for a lobby display, by room.",
        description: 'Authenticates with a screen device key (`?key=`) or, for a preview, a session holding `session.read`. Every state is NAMED (`no-term`), so an empty board is never drawn as emptiness. `nowMinute` and `generatedAt` are assembled per request; the rest is cached briefly per tenant + room scope.',
        parameters: [
            {
                in: 'query',
                name: 'key',
                required: false,
                schema: { type: 'string' },
                description: 'The screen device key. Omitted by a signed-in human previewing the board.',
            },
        ],
        responses: {
            200: {
                description: 'The board.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['screenName', 'generatedAt', 'nowMinute', 'state', 'dayStartMinute', 'dayEndMinute', 'planStartMinute', 'planEndMinute', 'rooms'],
                            properties: {
                                screenName: { type: 'string', nullable: true, description: 'Null for a signed-in preview.' },
                                generatedAt: { type: 'string', format: 'date-time' },
                                nowMinute: {
                                    type: 'integer',
                                    description: 'Minutes since TENANT-local midnight at the moment of the request. What the room plan draws its now line from; a display interpolates forward from it between polls rather than reading its own clock.',
                                },
                                state: {
                                    type: 'string',
                                    enum: ['ok', 'no-term'],
                                    description: 'Why the board looks the way it does. Never inferred from an empty list.',
                                },
                                termName: { type: 'string', description: 'Absent in the `no-term` state.' },
                                dayStartMinute: {
                                    type: 'integer',
                                    nullable: true,
                                    description: "First block's start for this weekday, in minutes since tenant-local midnight: the top of the room plan's axis. Null with no term running.",
                                },
                                dayEndMinute: {
                                    type: 'integer',
                                    nullable: true,
                                    description: "Last block's end for this weekday. Null with no term running.",
                                },
                                planStartMinute: {
                                    type: 'integer',
                                    nullable: true,
                                    description: "The configured start for the plan, minutes since tenant-local midnight, or null for the timetable's own day. Unlike `dayStartMinute` it is authoritative: the plan crops to it and names what falls outside. Read off the screen the `?key=` belongs to even for a signed-in preview, so a preview draws the hours the display was configured with; null when no key was presented.",
                                },
                                planEndMinute: {
                                    type: 'integer',
                                    nullable: true,
                                    description: "The screen's own configured end, on the same terms as `planStartMinute`.",
                                },
                                rooms: {
                                    type: 'array',
                                    description: 'Every active Room in the screen\'s scope, name-ordered. An empty room scope means every room.',
                                    items: {
                                        type: 'object',
                                        required: ['id', 'name', 'isVirtual', 'current', 'next', 'entries'],
                                        properties: {
                                            id: { type: 'string' },
                                            name: { type: 'string' },
                                            isVirtual: { type: 'boolean' },
                                            current: {
                                                nullable: true,
                                                type: 'object',
                                                description: 'The Session running in this Room at the time of the request, or null. Inlined rather than referenced: `defineRouteMeta` takes a pure object literal, so a shared schema cannot be composed here.',
                                                required: ['id', 'title', 'kind', 'groups', 'lecturers', 'coveringLecturer', 'startMinute', 'endMinute', 'isNow'],
                                                properties: {
                                                    id: { type: 'string', description: 'The Session id.' },
                                                    title: { type: 'string', description: "The Offering's title, the Session's own, or its kind's name, in that order." },
                                                    kind: { type: 'string', description: 'The tenant-managed SessionKind key. Open vocabulary: never matched against a hardcoded value.' },
                                                    groups: { type: 'array', items: { type: 'string' }, description: 'Group names, as the tenant wrote them.' },
                                                    lecturers: { type: 'array', items: { type: 'string' }, description: 'Names of the people assigned in the `lecturer` Role. Empty where nobody is assigned.' },
                                                    coveringLecturer: { type: 'string', nullable: true, description: 'Who is covering this occurrence (issue #30), or null. Non-null does NOT empty `lecturers`: the original assignment is untouched by a substitution.' },
                                                    startMinute: { type: 'integer', description: "First block's start, minutes since tenant-local midnight." },
                                                    endMinute: { type: 'integer', description: "Last block's end, minutes since tenant-local midnight." },
                                                    isNow: { type: 'boolean', description: 'Decided server-side, and only as fresh as the cache TTL. A display drawing minute-by-minute state uses the response\'s `nowMinute` instead.' },
                                                },
                                            },
                                            next: {
                                                nullable: true,
                                                type: 'object',
                                                description: 'The next Session to start in this Room after the time of the request, or null.',
                                                required: ['id', 'title', 'kind', 'groups', 'lecturers', 'coveringLecturer', 'startMinute', 'endMinute', 'isNow'],
                                                properties: {
                                                    id: { type: 'string', description: 'The Session id.' },
                                                    title: { type: 'string', description: "The Offering's title, the Session's own, or its kind's name, in that order." },
                                                    kind: { type: 'string', description: 'The tenant-managed SessionKind key. Open vocabulary: never matched against a hardcoded value.' },
                                                    groups: { type: 'array', items: { type: 'string' }, description: 'Group names, as the tenant wrote them.' },
                                                    lecturers: { type: 'array', items: { type: 'string' }, description: 'Names of the people assigned in the `lecturer` Role. Empty where nobody is assigned.' },
                                                    coveringLecturer: { type: 'string', nullable: true, description: 'Who is covering this occurrence (issue #30), or null. Non-null does NOT empty `lecturers`: the original assignment is untouched by a substitution.' },
                                                    startMinute: { type: 'integer', description: "First block's start, minutes since tenant-local midnight." },
                                                    endMinute: { type: 'integer', description: "Last block's end, minutes since tenant-local midnight." },
                                                    isNow: { type: 'boolean', description: 'Decided server-side, and only as fresh as the cache TTL. A display drawing minute-by-minute state uses the response\'s `nowMinute` instead.' },
                                                },
                                            },
                                            entries: {
                                                type: 'array',
                                                description: 'Every Session in this Room today, start-ordered. Includes the ones already over: the room plan draws the whole day and greys the past out rather than dropping it.',
                                                items: {
                                                    type: 'object',
                                                    description: 'One placed Session in this Room today.',
                                                    required: ['id', 'title', 'kind', 'groups', 'lecturers', 'coveringLecturer', 'startMinute', 'endMinute', 'isNow'],
                                                    properties: {
                                                        id: { type: 'string', description: 'The Session id.' },
                                                        title: { type: 'string', description: "The Offering's title, the Session's own, or its kind's name, in that order." },
                                                        kind: { type: 'string', description: 'The tenant-managed SessionKind key. Open vocabulary: never matched against a hardcoded value.' },
                                                        groups: { type: 'array', items: { type: 'string' }, description: 'Group names, as the tenant wrote them.' },
                                                        lecturers: { type: 'array', items: { type: 'string' }, description: 'Names of the people assigned in the `lecturer` Role. Empty where nobody is assigned.' },
                                                        coveringLecturer: { type: 'string', nullable: true, description: 'Who is covering this occurrence (issue #30), or null. Non-null does NOT empty `lecturers`: the original assignment is untouched by a substitution.' },
                                                        startMinute: { type: 'integer', description: "First block's start, minutes since tenant-local midnight." },
                                                        endMinute: { type: 'integer', description: "Last block's end, minutes since tenant-local midnight." },
                                                        isNow: { type: 'boolean', description: 'Decided server-side, and only as fresh as the cache TTL. A display drawing minute-by-minute state uses the response\'s `nowMinute` instead.' },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            401: { description: 'The key is not recognised.' },
            403: { description: 'The screen has been deactivated.' },
            409: { description: 'The key belongs to a screen configured as a substitution plan; the response names where to open it instead.' },
        },
    },
});

export default defineEventHandler(async (event) => {
    const key = getQuery(event).key;

    /*
     * The REVOKED case, answered before identity resolution. The resolver treats
     * an inactive screen as no identity at all (correct for it, since a revoked
     * key must not act), but that would reach the display as a bare 401, which
     * looks exactly like a mistyped URL. A screen that has been deliberately
     * turned off should say so, because that is a fact somebody walking past can
     * act on.
     */
    let keyedScreenId: string | null = null;

    if (typeof key === 'string' && key) {
        const screen = await resolveScreenKey(key);

        if (!screen) {
            throw createError({ statusCode: 401, message: 'This screen key is not recognised.' });
        }

        if (!screen.is_active) {
            throw createError({ statusCode: 403, message: 'This screen has been deactivated.' });
        }

        /*
         * KEPT, so a signed-in PREVIEW draws the hours the screen was actually
         * configured with (issue #131).
         *
         * A session outranks a key by design (`screenKeyResolver` is last in
         * the chain: "a signed-in human at a screen URL stays themselves"), and
         * the management UI opens the display in a new tab of the browser the
         * operator is signed in to, so the preview arrives here as an ACCOUNT.
         * With the window read only off a screen identity, somebody who had
         * just set 08:00-16:00 would open their own preview, see the whole day,
         * and conclude the setting does not work.
         *
         * This is presentation and NOTHING ELSE: the id is used below for one
         * read of two integer columns, inside the tenant transaction, so RLS
         * still decides whether that row is even visible. Authority stays with
         * the identity, and the room scope with it, which is the pre-existing
         * limit of previewing as yourself.
         */
        keyedScreenId = screen.screen_id;
    }

    return withRequestTenant(event, async (tx, identity) => {
        if (identity.kind !== 'screen') {
            // Everyone but the device pays the ordinary permission: a human
            // previewing, an API token just the same. `!== 'screen'` rather
            // than `=== 'account'` so a principal added later is gated here by
            // default instead of slipping through unchecked.
            await requirePermission(event, tx, 'session.read');
        }

        if (identity.kind === 'screen' && identity.mode !== 'ROOM_BOARD') {
            /*
             * THE MODE IS ENFORCED, not merely stored (issue #31). A key
             * belonging to a substitution-plan screen is refused BY NAME, with
             * the address that would work, rather than being served a room
             * board it was never meant to draw: a wall showing the wrong board
             * confidently is the failure nobody walking past can diagnose.
             * `mode: null` (a stored value this version does not recognise)
             * lands here too, rather than defaulting into this board.
             */
            throw createError({
                statusCode: 409,
                message: `This screen is not configured as a room board. Open it at ${SCREEN_MODE_PATHS.SUBSTITUTION_PLAN} instead.`,
                data: { mode: identity.mode, openAt: SCREEN_MODE_PATHS.SUBSTITUTION_PLAN },
            });
        }

        const now = new Date();

        /*
         * The scope itself. An EMPTY `roomIds` means every room (fail-open,
         * matching the table), so it becomes an absent filter rather than
         * `in: []`, which would silently match nothing and produce a blank
         * display for the most common configuration there is. Read straight
         * off the identity, with no query: it is also exactly what the cache
         * key below is keyed on.
         */
        const scopedRoomIds = identity.kind === 'screen' ? identity.roomIds : [];

        /*
         * A liveness stamp, recorded on EVERY successful fetch and therefore
         * before anything that can return early, and NEVER affected by the
         * cache below: a screen that only ever hits a cached response must
         * still be marked seen.
         *
         * Two bugs live here, both shipped and both caught by checking the column
         * rather than the response. First it was a fire-and-forget
         * `getPrisma().$executeRaw` OUTSIDE this transaction, which matched zero
         * rows every time, because the app role runs under `FORCE ROW LEVEL SECURITY`
         * and there is no `current_tenant_id()` out there. Then, once inside, it
         * sat AFTER the no-term return, so every display in the institution
         * looked dead for the whole summer.
         */
        /*
         * The screen's OWN plan window comes back from this same UPDATE (issue
         * #131). Not from the identity, which is resolved by
         * `screen_identity()` and carries only what authorisation needs, and
         * not from a second read: the row is already being written here on
         * every fetch, and `update` returns it.
         */
        let configured: { planStartMinute: number | null; planEndMinute: number | null } = {
            planStartMinute: null,
            planEndMinute: null,
        };

        if (identity.kind === 'screen') {
            configured = await tx.screen.update({
                where: { id: identity.screenId },
                data: { lastSeenAt: now },
                select: { planStartMinute: true, planEndMinute: true },
            });
        } else if (keyedScreenId) {
            // The preview path. `findFirst` through the tenant transaction, so
            // a key belonging to another institution simply finds nothing
            // rather than leaking that institution's configuration; and NO
            // `lastSeenAt` stamp, because a human looking at a board is not
            // evidence that the display on the wall is alive.
            configured = await tx.screen.findFirst({
                where: { id: keyedScreenId },
                select: { planStartMinute: true, planEndMinute: true },
            }) ?? configured;
        }

        /*
         * "Today" and "now" are the TENANT's, never the server's
         * (Tenant.timezone: all grid logic runs in that zone). The server
         * clock is typically UTC in a container, so deriving the weekday or
         * the minute-of-day from it would shift every entry for an
         * institution in another zone, and flip the day entirely around
         * local midnight.
         *
         * OUTSIDE THE CACHE, and passed in, because `nowMinute` below is
         * assembled per request while the board it labels is cached: the
         * timezone is a tenant constant, so this is one trivial read against
         * a transaction that is already writing `lastSeenAt`.
         */
        const tenant = await tx.tenant.findUniqueOrThrow({
            where: { id: identity.tenantId },
            select: { timezone: true },
        });
        const local = localNow(now, tenant.timezone);

        /**
         * Cache freshness (issue #66): keyed per tenant + room-scope, as
         * polled continuously by wall-mounted displays. `screenName` and
         * `generatedAt` are deliberately assembled AFTER this, never inside
         * it; see `boardCacheKey`'s own comment on why (two screens can
         * share a room scope while having different names).
         *
         * "Immediately visible after a manual edit" depends on
         * `invalidateScheduleCache()` firing from `appendEvent()`
         * (server/utils/sessionEvents.ts). The TTL backstop additionally
         * bounds how stale `current`/`next`/`isNow` can get between events:
         * those are minute-sensitive even with no schedule change at all
         * (a class starting or ending), which an event-only invalidation
         * would never catch; "today's board barely changes minute to
         * minute" (the issue's own words) is what makes that acceptable at
         * this TTL.
         */
        const cacheKey = boardCacheKey({ tenantId: identity.tenantId, roomIds: scopedRoomIds });
        const payload = await getCached(cacheKey, () => buildBoardPayload(tx, { tenantId: identity.tenantId, scopedRoomIds, local }), SCHEDULE_CACHE_TTL_SECONDS);

        return {
            screenName: identity.kind === 'screen' ? identity.screenName : null,
            generatedAt: now.toISOString(),
            /*
             * THE TENANT'S MINUTE, assembled outside the cache for the same
             * reason `generatedAt` is: it is the one value in this response
             * that is wrong the moment it is a second old, and the room plan
             * draws its now line and greys out finished Sessions from it.
             *
             * The display interpolates forward from here with its own clock
             * between polls, which is a device clock used for SECONDS of
             * drift, never for what time the institution thinks it is. A
             * display deriving "now" from the machine behind it disagreed
             * with the schedule it was drawing, which is the failure this
             * field exists to make impossible.
             */
            nowMinute: local.minutes,
            ...payload,
            /*
             * OUTSIDE THE CACHE, and after the payload, for exactly the reason
             * `screenName` is: the cache is keyed on tenant + room scope, and
             * two screens can share a room scope while being told to draw
             * different hours. Sent ALONGSIDE the grid-derived
             * `dayStartMinute`/`dayEndMinute` rather than replacing them,
             * because the client treats the two differently: a derived end
             * widens to fit an outlying Session, a configured one crops and
             * says so (`roomPlanWindow`).
             *
             * Read off the screen the `?key=` belongs to even when the
             * request resolved to an ACCOUNT (the preview case), because this
             * is presentation and not authority; null when no key was
             * presented at all. See `keyedScreenId` above.
             */
            planStartMinute: configured.planStartMinute,
            planEndMinute: configured.planEndMinute,
        };
    });
});

/**
 * `dayStartMinute`/`dayEndMinute` are the DAY WINDOW the room plan draws its
 * axis from: the tenant's own first block start and last block end for this
 * weekday, breaks and all (`blockSpan` resolves day-specific overrides).
 *
 * SENT RATHER THAN INFERRED FROM THE ENTRIES, because a day with two lessons in
 * it is still a whole teaching day: an axis derived from what happens to be
 * placed would redraw itself every time somebody moved a Session, and a room
 * plan on a wall whose 09:00 line is at a different height each morning is not
 * a plan. Null in the `no-term` state, where there is no grid to ask; the client
 * falls back to a plausible working day and the state's own note is what
 * explains the emptiness (`roomPlanWindow`, app/utils/roomPlan.ts).
 */
type BoardPayload =
    | {
        state: 'no-term';
        dayStartMinute: null;
        dayEndMinute: null;
        rooms: { id: string; name: string; isVirtual: boolean; current: null; next: null; entries: never[] }[];
    }
    | { state: 'ok'; termName: string; dayStartMinute: number; dayEndMinute: number; rooms: unknown[] };

async function buildBoardPayload(tx: Tx, options: { tenantId: string; scopedRoomIds: string[]; local: TenantLocalNow }): Promise<BoardPayload> {
    const local = options.local;

    const rooms = await tx.room.findMany({
        where: {
            isActive: true,
            ...(options.scopedRoomIds.length ? { id: { in: options.scopedRoomIds } } : {}),
        },
        orderBy: { name: 'asc' },
    });

    // Date-only columns compare against the tenant-local calendar day
    // (`local.date` is its UTC midnight), so the term's first and last
    // days count as inside it in the institution's own zone.
    const term = await tx.term.findFirst({
        where: { startDate: { lte: local.date }, endDate: { gte: local.date } },
        include: { timeGrid: { include: { breaks: true } } },
        orderBy: { startDate: 'asc' },
    });

    /*
     * NO TERM RUNNING is a legitimate, common state (the summer between two
     * terms), and it is NAMED rather than left to look like an outage.
     *
     * The rooms still come back, empty. A corridor display in August should
     * read "Room A: Free", which is true and useful, plus a line saying no
     * term is running; returning nothing at all would make a working screen
     * indistinguishable from a broken one for two months of the year. An
     * earlier version returned `rooms: []` here and did exactly that.
     */
    if (!term?.timeGrid) {
        return {
            state: 'no-term' as const,
            dayStartMinute: null,
            dayEndMinute: null,
            rooms: rooms.map((room) => ({
                id: room.id,
                name: room.name,
                isVirtual: room.isVirtual,
                current: null,
                next: null,
                entries: [],
            })),
        };
    }

    const grid = term.timeGrid;
    const dayOfWeek = isoWeekday(local.date);
    // `weekIndexOf` is 0-based; `session.term_week` is 1-based.
    const termWeek = weekIndexOf(term.startDate, local.date) + 1;

    /**
     * `.filter(isPlacedSession)` narrows `blockIndex` to `number` below.
     * Redundant with the `where` clause at runtime: `termWeek`/`dayOfWeek`
     * are equality-matched against concrete numbers, so a banked Session
     * (issue #22, both null) can never be a row here. But a WHERE clause
     * proves nothing to the type checker.
     */
    const sessions = (await tx.session.findMany({
        where: {
            termId: term.id,
            termWeek,
            dayOfWeek,
            rooms: { some: { roomId: { in: rooms.map((room) => room.id) } } },
        },
        include: {
            offering: { select: { title: true } },
            kind: { select: { key: true, name: true } },
            rooms: { select: { roomId: true } },
            groups: { include: { group: { select: { name: true } } } },
            /*
             * WHO IS TEACHING IT, which is half of what somebody reads a room
             * plan for ("is my lecturer in there"). The role KEY travels with
             * the row rather than being resolved client-side: a screen holds
             * no permission at all, so it could never fetch /api/roles to find
             * out which assignment is the lecturer's.
             */
            people: { select: { role: { select: { key: true } }, person: { select: { givenName: true, familyName: true } } } },
            /*
             * Issue #30: the plan draws the person who is ACTUALLY there.
             * Read alongside `people` rather than replacing it, because the
             * original lecturer's `session_person` row is untouched by a
             * substitution, and a wall that named the absent lecturer would
             * send students to look for the wrong person.
             */
            substitution: { include: { coveringPerson: { select: { givenName: true, familyName: true } } } },
        },
    })).filter(isPlacedSession);

    const minutesNow = local.minutes;

    const board = rooms.map((room) => {
        const entries = sessions
            .filter((session) => session.rooms.some((link) => link.roomId === room.id))
            .map((session) => {
                const first = blockSpan(grid, session.blockIndex, dayOfWeek);
                const last = blockSpan(grid, session.blockIndex + session.durationBlocks - 1, dayOfWeek);

                return {
                    id: session.id,
                    title: session.offering?.title ?? session.title ?? session.kind.name,
                    kind: session.kind.key,
                    groups: session.groups.map((link) => link.group.name),
                    lecturers: session.people
                        .filter((link) => link.role?.key === LECTURER_ROLE_KEY)
                        .map((link) => personName(link.person)),
                    coveringLecturer: session.substitution
                        ? personName(session.substitution.coveringPerson)
                        : null,
                    startMinute: first.start,
                    endMinute: last.end,
                    /*
                     * Computed server-side, from the same clock that picked
                     * the term week and weekday. A display left running for
                     * months would otherwise decide "now" from a device
                     * whose clock nobody checks, and disagree with the
                     * schedule it is drawing.
                     */
                    isNow: minutesNow >= first.start && minutesNow < last.end,
                };
            })
            .sort((a, b) => a.startMinute - b.startMinute);

        const current = entries.find((entry) => entry.isNow) ?? null;

        return {
            id: room.id,
            name: room.name,
            isVirtual: room.isVirtual,
            current,
            next: entries.find((entry) => entry.startMinute > minutesNow) ?? null,
            entries,
        };
    });

    return {
        state: 'ok' as const,
        termName: term.name,
        /*
         * The grid's own day, not the entries': see `BoardPayload`. Both ends
         * come from `blockSpan` with this weekday, so a day whose breaks move
         * its blocks (a day-specific `time_grid_break`) gets its own window
         * rather than every day's average.
         */
        dayStartMinute: blockSpan(grid, 0, dayOfWeek).start,
        dayEndMinute: blockSpan(grid, Math.max(0, grid.blocksPerDay - 1), dayOfWeek).end,
        rooms: board,
    };
}

/**
 * The same rendering `server/utils/substitutionBoard.ts` uses, character for
 * character and deliberately: the two boards hang in the same corridor, and a
 * lecturer written one way on one and another way on the other reads as two
 * people. (The `${given} ${family}`.trim() idiom is repeated in about ten
 * places in this repo; unifying them is a change of its own, not this one's.)
 */
function personName(person: { givenName: string; familyName: string }): string {
    return `${person.givenName} ${person.familyName}`.trim();
}
