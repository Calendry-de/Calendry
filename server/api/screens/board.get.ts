import { blockSpan } from '../../../shared/timeGrid';
import { isoWeekday, weekIndexOf } from '../../../shared/academicCalendar';
import { isPlacedSession } from '../../../shared/sessionPlacement';
import { getCached } from '../../utils/cache';
import { boardCacheKey, SCHEDULE_CACHE_TTL_SECONDS } from '../../utils/scheduleCache';
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
 * question — "what is happening in the rooms around me, and is this one free
 * right now". The grid cannot be reshaped into that answer by filtering.
 *
 * AUTHORITY IS THE KEY, NOT A PERMISSION. A screen resolves to a
 * `ScreenIdentity` whose `actorPersonId` is null, so `requirePermission()` would
 * throw 403 for it no matter which permission were named — deliberately: a
 * display holds no role and must never be able to acquire one. Its authority is
 * its room scope, and this route is the only thing that reads it.
 *
 * A SIGNED-IN HUMAN MAY ALSO CALL IT, gated on `session.read`, so the management
 * UI can preview a screen before anybody mounts it on a wall. That is the same
 * "two callers, different purposes" shape as `GET /api/display-settings`.
 */
export default defineEventHandler(async (event) => {
    const key = getQuery(event).key;

    /*
     * The REVOKED case, answered before identity resolution. The resolver treats
     * an inactive screen as no identity at all — correct for it, since a revoked
     * key must not act — but that would reach the display as a bare 401, which
     * looks exactly like a mistyped URL. A screen that has been deliberately
     * turned off should say so, because that is a fact somebody walking past can
     * act on.
     */
    if (typeof key === 'string' && key) {
        const screen = await resolveScreenKey(key);

        if (!screen) {
            throw createError({ statusCode: 401, statusMessage: 'This screen key is not recognised.' });
        }

        if (!screen.is_active) {
            throw createError({ statusCode: 403, statusMessage: 'This screen has been deactivated.' });
        }
    }

    return withRequestTenant(event, async (tx, identity) => {
        if (identity.kind !== 'screen') {
            // Everyone but the device pays the ordinary permission — a human
            // previewing, an API token just the same. `!== 'screen'` rather
            // than `=== 'account'` so a principal added later is gated here by
            // default instead of slipping through unchecked.
            await requirePermission(event, tx, 'session.read');
        }

        const now = new Date();

        /*
         * The scope itself. An EMPTY `roomIds` means every room — fail-open,
         * matching the table — so it becomes an absent filter rather than
         * `in: []`, which would silently match nothing and produce a blank
         * display for the most common configuration there is. Read straight
         * off the identity, with no query: it is also exactly what the cache
         * key below is keyed on.
         */
        const scopedRoomIds = identity.kind === 'screen' ? identity.roomIds : [];

        /*
         * A liveness stamp, recorded on EVERY successful fetch and therefore
         * before anything that can return early, and NEVER affected by the
         * cache below — a screen that only ever hits a cached response must
         * still be marked seen.
         *
         * Two bugs live here, both shipped and both caught by checking the column
         * rather than the response. First it was a fire-and-forget
         * `getPrisma().$executeRaw` OUTSIDE this transaction, which matched zero
         * rows every time — the app role runs under `FORCE ROW LEVEL SECURITY`
         * and there is no `current_tenant_id()` out there. Then, once inside, it
         * sat AFTER the no-term return, so every display in the institution
         * looked dead for the whole summer.
         */
        if (identity.kind === 'screen') {
            await tx.screen.update({
                where: { id: identity.screenId },
                data: { lastSeenAt: now },
            });
        }

        /**
         * Cache freshness (issue #66): keyed per tenant + room-scope, as
         * polled continuously by wall-mounted displays. `screenName` and
         * `generatedAt` are deliberately assembled AFTER this, never inside
         * it — see `boardCacheKey`'s own comment on why (two screens can
         * share a room scope while having different names).
         *
         * "Immediately visible after a manual edit" depends on
         * `invalidateScheduleCache()` firing from `appendEvent()`
         * (server/utils/sessionEvents.ts). The TTL backstop additionally
         * bounds how stale `current`/`next`/`isNow` can get between events —
         * those are minute-sensitive even with no schedule change at all
         * (a class starting or ending), which an event-only invalidation
         * would never catch; "today's board barely changes minute to
         * minute" (the issue's own words) is what makes that acceptable at
         * this TTL.
         */
        const cacheKey = boardCacheKey({ tenantId: identity.tenantId, roomIds: scopedRoomIds });
        const payload = await getCached(cacheKey, () => buildBoardPayload(tx, { tenantId: identity.tenantId, scopedRoomIds, now }), SCHEDULE_CACHE_TTL_SECONDS);

        return {
            screenName: identity.kind === 'screen' ? identity.screenName : null,
            generatedAt: now.toISOString(),
            ...payload,
        };
    });
});

type BoardPayload =
    | { state: 'no-term'; rooms: { id: string; name: string; isVirtual: boolean; current: null; next: null; entries: never[] }[] }
    | { state: 'ok'; termName: string; rooms: unknown[] };

async function buildBoardPayload(tx: Tx, options: { tenantId: string; scopedRoomIds: string[]; now: Date }): Promise<BoardPayload> {
    /*
     * "Today" and "now" are the TENANT's, never the server's
     * (Tenant.timezone — all grid logic runs in that zone). The server
     * clock is typically UTC in a container, so deriving the weekday or
     * the minute-of-day from it would shift every entry for an
     * institution in another zone, and flip the day entirely around
     * local midnight.
     */
    const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: options.tenantId },
        select: { timezone: true },
    });
    const local = localNow(options.now, tenant.timezone);

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
     * NO TERM RUNNING is a legitimate, common state — the summer between two
     * terms — and it is NAMED rather than left to look like an outage.
     *
     * The rooms still come back, empty. A corridor display in August should
     * read "Room A — Free", which is true and useful, plus a line saying no
     * term is running; returning nothing at all would make a working screen
     * indistinguishable from a broken one for two months of the year. An
     * earlier version returned `rooms: []` here and did exactly that.
     */
    if (!term?.timeGrid) {
        return {
            state: 'no-term' as const,
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
     * Redundant with the `where` clause at runtime — `termWeek`/`dayOfWeek`
     * are equality-matched against concrete numbers, so a banked Session
     * (issue #22, both null) can never be a row here — but a WHERE clause
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
        rooms: board,
    };
}
