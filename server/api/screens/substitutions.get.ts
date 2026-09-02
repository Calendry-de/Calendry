import { SCREEN_MODE_PATHS } from '../../../shared/screenKey';
import { getCached } from '../../utils/cache';
import { isoDate } from '../../../shared/academicCalendar';
import { SCHEDULE_CACHE_TTL_SECONDS, substitutionBoardCacheKey } from '../../utils/scheduleCache';
import { localNow } from '../../utils/solverCalendar';
import { buildSubstitutionPayload, expandScreenGroupScope } from '../../utils/substitutionBoard';
import { withRequestTenant } from '../../utils/tenantDb';
import { resolveScreenKey } from '../../utils/authDb';

/**
 * What a substitution-plan display shows: today and tomorrow, by CHANGE.
 *
 * ITS OWN ROUTE ALONGSIDE `GET /api/screens/board`, not a parameter on it, for
 * the same reason the board is its own route rather than a filter on the
 * schedule: this is a different question with a different answer shape. The
 * board transposes the timetable by ROOM; this one selects the DIFF against it
 * and reads three sources no room query touches (`session_substitution`, and
 * the `BANK`/`MOVE` event log). See `server/utils/substitutionBoard.ts`.
 *
 * SAME AUTHORITY RULES AS THE BOARD, deliberately identical rather than
 * merely similar. A screen resolves to a `ScreenIdentity` whose
 * `actorPersonId` is null, so `requirePermission()` would throw 403 for it no
 * matter which permission were named. Its authority is its own scope, and this
 * route is the only thing that reads the GROUP half of it. A signed-in human
 * may also call it, gated on `session.read`, so the management UI can preview
 * a plan before anybody mounts it on a wall.
 *
 * THE MODE IS ENFORCED, not merely stored. A key belonging to a `ROOM_BOARD`
 * screen is refused here BY NAME, with the address it should be opened at
 * instead, and `board.get.ts` refuses a `SUBSTITUTION_PLAN` key the same way.
 * A display drawing the wrong board confidently is the worse failure: nothing
 * on the wall would say anything was wrong.
 */
defineRouteMeta({
    openAPI: {
        tags: ['Screens'],
        summary: 'Substitution plan for a lobby display: today and tomorrow.',
        description: 'Authenticates with a screen device key (`?key=`) or, for a preview, a session holding `session.read`. Every day in the window is returned with a NAMED state, so an empty day is never drawn as emptiness.',
        parameters: [
            {
                in: 'query',
                name: 'key',
                required: false,
                schema: { type: 'string' },
                description: 'The screen device key. Omitted by a signed-in human previewing the plan.',
            },
        ],
        responses: {
            200: {
                description: 'The plan.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['screenName', 'generatedAt', 'mode', 'days'],
                            properties: {
                                screenName: { type: 'string', nullable: true, description: 'Null for a signed-in preview.' },
                                generatedAt: { type: 'string', format: 'date-time' },
                                mode: { type: 'string', enum: ['SUBSTITUTION_PLAN'] },
                                days: {
                                    type: 'array',
                                    description: 'Always two entries: today (offset 0) and tomorrow (offset 1).',
                                    items: {
                                        type: 'object',
                                        required: ['date', 'isoWeekday', 'offset', 'state', 'termName', 'entries'],
                                        properties: {
                                            date: { type: 'string', format: 'date', description: 'Tenant-local calendar day.' },
                                            isoWeekday: { type: 'integer', minimum: 1, maximum: 7 },
                                            offset: { type: 'integer', minimum: 0, maximum: 1 },
                                            state: {
                                                type: 'string',
                                                enum: ['ok', 'no-substitutions', 'no-term', 'not-a-teaching-day'],
                                                description: 'Why the day looks the way it does. Never inferred from an empty list.',
                                            },
                                            termName: { type: 'string', nullable: true },
                                            entries: {
                                                type: 'array',
                                                items: {
                                                    type: 'object',
                                                    required: ['sessionId', 'change', 'title', 'kind', 'groups', 'rooms', 'originalLecturers', 'coveringLecturer', 'reason', 'slot', 'movedFrom', 'movedTo', 'isNow'],
                                                    properties: {
                                                        sessionId: { type: 'string' },
                                                        change: { type: 'string', enum: ['covered', 'cancelled', 'moved-in', 'moved-away'] },
                                                        title: { type: 'string' },
                                                        kind: { type: 'string' },
                                                        groups: { type: 'array', items: { type: 'string' } },
                                                        rooms: { type: 'array', items: { type: 'string' } },
                                                        originalLecturers: { type: 'array', items: { type: 'string' } },
                                                        coveringLecturer: { type: 'string', nullable: true },
                                                        reason: { type: 'string', nullable: true },
                                                        slot: {
                                                            type: 'object',
                                                            nullable: true,
                                                            required: ['isoWeekday', 'blockIndex', 'startMinute', 'endMinute'],
                                                            properties: {
                                                                isoWeekday: { type: 'integer' },
                                                                blockIndex: { type: 'integer' },
                                                                startMinute: { type: 'integer' },
                                                                endMinute: { type: 'integer' },
                                                            },
                                                        },
                                                        movedFrom: {
                                                            type: 'object',
                                                            nullable: true,
                                                            required: ['isoWeekday', 'blockIndex', 'startMinute', 'endMinute'],
                                                            properties: {
                                                                isoWeekday: { type: 'integer' },
                                                                blockIndex: { type: 'integer' },
                                                                startMinute: { type: 'integer' },
                                                                endMinute: { type: 'integer' },
                                                            },
                                                        },
                                                        movedTo: {
                                                            type: 'object',
                                                            nullable: true,
                                                            required: ['isoWeekday', 'blockIndex', 'startMinute', 'endMinute'],
                                                            properties: {
                                                                isoWeekday: { type: 'integer' },
                                                                blockIndex: { type: 'integer' },
                                                                startMinute: { type: 'integer' },
                                                                endMinute: { type: 'integer' },
                                                            },
                                                        },
                                                        isNow: { type: 'boolean', description: 'Decided server-side, and only ever true for today.' },
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
            401: { description: 'The key is not recognised, or no credential was presented.' },
            403: { description: 'The screen has been deactivated, or the caller lacks `session.read`.' },
            409: { description: 'This key belongs to a screen configured for another mode.' },
        },
    },
});

export default defineEventHandler(async (event) => {
    const key = getQuery(event).key;

    /*
     * The REVOKED case, answered before identity resolution, exactly as the
     * room board answers it: the resolver treats an inactive screen as no
     * identity at all, which would reach the wall as a bare 401 that looks
     * like a mistyped URL. A screen deliberately turned off should say so,
     * because that is a fact somebody walking past can act on.
     */
    if (typeof key === 'string' && key) {
        const screen = await resolveScreenKey(key);

        if (!screen) {
            throw createError({ statusCode: 401, message: 'This screen key is not recognised.' });
        }

        if (!screen.is_active) {
            throw createError({ statusCode: 403, message: 'This screen has been deactivated.' });
        }
    }

    return withRequestTenant(event, async (tx, identity) => {
        if (identity.kind !== 'screen') {
            // Everyone but the device pays the ordinary permission. `!== 'screen'`
            // rather than `=== 'account'` so a principal added later is gated here
            // by default instead of slipping through unchecked.
            await requirePermission(event, tx, 'session.read');
        }

        if (identity.kind === 'screen' && identity.mode !== 'SUBSTITUTION_PLAN') {
            /*
             * REFUSED BY NAME, with the address that would work. Drawing a
             * substitution plan for a room-board key would be a silent
             * mis-render nobody standing in the corridor could diagnose, and
             * `mode: null` (a value this version does not recognise) lands
             * here too rather than being coerced into either board.
             */
            throw createError({
                statusCode: 409,
                message: `This screen is not configured as a substitution plan. Open it at ${SCREEN_MODE_PATHS.ROOM_BOARD} instead.`,
                data: { mode: identity.mode, openAt: SCREEN_MODE_PATHS.ROOM_BOARD },
            });
        }

        const now = new Date();

        /*
         * The GROUP axis, and only it. An EMPTY `groupIds` means every group
         * (fail-open, matching the table and `screen_room`), so it becomes an
         * absent filter rather than `in: []`, which would silently match
         * nothing and blank the display for the most common configuration
         * there is. The room axis is deliberately NOT consulted: see the
         * `ScreenMode` enum's own comment on why the two are not ANDed.
         */
        const scopedGroupIds = await expandScreenGroupScope(
            tx,
            identity.kind === 'screen' ? identity.groupIds : [],
        );

        /*
         * The liveness stamp, on EVERY successful fetch, before anything that
         * can return early and never affected by the cache below: a screen
         * that only ever hits a cached response must still be marked seen.
         * Inside the tenant transaction, because the app role runs under
         * `FORCE ROW LEVEL SECURITY` and an UPDATE outside it matches zero
         * rows, silently — the exact bug the room board shipped twice.
         */
        if (identity.kind === 'screen') {
            await tx.screen.update({ where: { id: identity.screenId }, data: { lastSeenAt: now } });
        }

        /*
         * "Today" is the TENANT's, never the server's and never the device's
         * (CLAUDE.md: timezone is per-Person and DISPLAY-only; all grid logic
         * runs in the institution's zone). A container clock is typically UTC,
         * so deriving the weekday from it would flip the whole board around
         * local midnight — and this board's entire subject is which day it is.
         */
        const tenant = await tx.tenant.findUniqueOrThrow({
            where: { id: identity.tenantId },
            select: { timezone: true },
        });
        const local = localNow(now, tenant.timezone);

        const cacheKey = substitutionBoardCacheKey({
            tenantId: identity.tenantId,
            groupIds: scopedGroupIds,
            localDate: isoDate(local.date),
        });

        /*
         * Cached on the same terms as the room board, and invalidated by the
         * same mechanism: every write this payload depends on appends a
         * SessionEvent (`SUBSTITUTE`, `BANK`, `MOVE`), and `appendEvent()`
         * calls `invalidateScheduleCache()`. A stale substitution board is
         * worse than a slow one, so the event-driven drop is what matters
         * here and the TTL is only the backstop that bounds `isNow`.
         */
        const payload = await getCached(
            cacheKey,
            () => buildSubstitutionPayload(tx, {
                tenantId: identity.tenantId,
                scopedGroupIds,
                localDate: local.date,
                localMinutes: local.minutes,
            }),
            SCHEDULE_CACHE_TTL_SECONDS,
        );

        return {
            // Assembled AFTER the cache, never inside it: two screens can share
            // a group scope (and so a cache key) while having different names.
            screenName: identity.kind === 'screen' ? identity.screenName : null,
            generatedAt: now.toISOString(),
            mode: 'SUBSTITUTION_PLAN' as const,
            ...payload,
        };
    });
});
