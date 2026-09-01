import { addDays } from '../../../shared/academicCalendar';
import { isPlacedSession } from '../../../shared/sessionPlacement';
import { getCached } from '../../utils/cache';
import type { ExportSession, ExportTermGroup } from '../../utils/icalExport';
import { buildIcs, weekRangeOf } from '../../utils/icalExport';
import { icsCacheKey, SCHEDULE_CACHE_TTL_SECONDS } from '../../utils/scheduleCache';
import { groupSessionClause, ownSessionClause } from '../../utils/scheduleScope';
import { localNow } from '../../utils/solverCalendar';
import type { Tx } from '../../utils/tenantDb';
import { withTenant } from '../../utils/tenantDb';
import type { IcsLinkIdentity } from '../../utils/tenantResolver';
import { icsLinkResolver } from '../../utils/tenantResolver';

defineRouteMeta({
    openAPI: {
        tags: ['Calendar links'],
        summary: 'Stream a Person’s own Sessions, or specific Groups’, as a subscribable .ics feed',
        description: 'The stream half of issue #15 — a calendar app fetches this on its own schedule, unlike GET /api/me/schedule.ics which no longer exists. Identified by the ics_link token in the query string alone; there is no session and no permission check, only the link’s own scope (ALL, bounded to its stored weeksAhead window, or one TERM in full) and subject (issue #115: the creator’s own Sessions, or one or more Groups’ instead). Public in the sense that `/api/screens/board` is: reachable with no cookie, because the token in the query string IS the credential — see tenant-context.ts.',
        parameters: [
            { name: 'token', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
            200: {
                description: 'A VCALENDAR, always — even an empty one for a link with no matching Sessions right now.',
                content: { 'text/calendar': { schema: { type: 'string' } } },
            },
            401: { description: 'No token, or one that does not resolve to an active link on an active Person.' },
        },
    },
});

/**
 * Resolves its OWN identity via `icsLinkResolver` and opens the tenant
 * transaction directly with `withTenant()` — deliberately not
 * `withRequestTenant()`/`event.context.identity`, which come from the global
 * middleware's `activeResolver`. `icsLinkResolver` is excluded from that
 * chain on purpose (see its own comment in tenantResolver.ts): this is the
 * one place it may run.
 */
export default defineEventHandler(async (event) => {
    const identity = await icsLinkResolver(event);

    // The second half is unreachable in practice — `icsLinkResolver` only ever
    // returns `null` or an `ics_link` — but it is what narrows `identity` from
    // `RequestIdentity` to `IcsLinkIdentity` for the fields read below.
    if (!identity || identity.kind !== 'ics_link') {
        throw createError({ statusCode: 401, statusMessage: 'This calendar link is not recognised.' });
    }

    return withTenant(identity, async (tx) => {
        /**
         * Cache freshness (issue #66): this is the highest-frequency,
         * lowest-value-per-hit read in the app — an external calendar client
         * re-fetches on its own schedule, unaware whether anything changed.
         * "Immediately visible after a manual edit" depends on
         * `invalidateScheduleCache()` firing from `appendEvent()`
         * (server/utils/sessionEvents.ts), the single choke point every
         * schedule-changing write passes through. The TTL is a backstop
         * only, in case an invalidation path is ever missed — an external
         * client re-polling on its own cadence will pick up the change on
         * its next fetch either way.
         */
        const cacheKey = icsCacheKey({
            tenantId: identity.tenantId,
            linkId: identity.linkId,
            scope: identity.scope,
            termId: identity.termId,
        });

        const ics = await getCached(cacheKey, () => buildIcsFeed(tx, identity), SCHEDULE_CACHE_TTL_SECONDS);

        setResponseHeader(event, 'content-type', 'text/calendar; charset=utf-8');
        // Deliberately NOT `content-disposition: attachment` — this is a feed
        // a calendar app re-fetches in place, not a file a browser saves once.

        return ics;
    });
});

/** The actual query + iCal assembly, extracted so it can be read-through cached. */
async function buildIcsFeed(tx: Tx, identity: IcsLinkIdentity): Promise<string> {
    // SUBJECT (issue #115): explicit Group(s) if the link named any, else the
    // creator's own Sessions — unchanged since issue #15. See the `ics_link`
    // model's own comment.
    const own = identity.groupIds.length
        ? await groupSessionClause(tx, identity.groupIds)
        : await ownSessionClause(tx, identity);
    const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: identity.tenantId },
        select: { timezone: true },
    });

    const terms = identity.scope === 'TERM'
        ? (identity.termId
            ? await tx.term.findMany({
                where: { id: identity.termId, tenantId: identity.tenantId },
                include: { timeGrid: true },
            })
            : [])
        : await tx.term.findMany({
            where: { tenantId: identity.tenantId },
            include: { timeGrid: true },
        });

    /*
     * ALL is bounded to a rolling window from "today" in the TENANT's own
     * calendar day (CLAUDE.md: timezone is per-Person and display-only,
     * so "today" for the purpose of a week boundary is always
     * tenant-local) — an unbounded "every Term this Person has ever had
     * a Session in" would make every refetch of a long-lived link walk
     * years of history. TERM streams the whole Term, which already
     * bounds itself.
     */
    const windowStart = identity.scope === 'ALL' && identity.weeksAhead
        ? localNow(new Date(), tenant.timezone).date
        : null;
    const windowEnd = windowStart && identity.weeksAhead
        ? addDays(windowStart, identity.weeksAhead * 7)
        : null;

    const groups: ExportTermGroup[] = [];

    for (const term of terms) {
        if (!term.timeGrid) {
            continue;
        }

        /*
         * `weekRangeOf` clamps `first` to at least 1 but not `last` — a
         * Term entirely outside the window (e.g. `windowEnd` before the
         * Term even starts) yields `last < first`, which the `termWeek`
         * range below matches zero rows for. No Term needs excluding up
         * front.
         */
        const range = windowStart && windowEnd ? weekRangeOf(term.startDate, windowStart, windowEnd) : null;

        const rows = await tx.session.findMany({
            where: {
                termId: term.id,
                AND: [own],
                termWeek: range ? { gte: range.first, lte: range.last } : { not: null },
            },
            include: { offering: { select: { title: true } }, rooms: { include: { room: true } } },
            orderBy: [{ termWeek: 'asc' }, { dayOfWeek: 'asc' }, { blockIndex: 'asc' }],
        });

        const sessions: ExportSession[] = rows.filter(isPlacedSession).map((row) => ({
            id: row.id,
            termWeek: row.termWeek,
            dayOfWeek: row.dayOfWeek,
            blockIndex: row.blockIndex,
            durationBlocks: row.durationBlocks,
            title: row.offering?.title ?? row.title ?? 'Untitled event',
            location: row.rooms[0]?.room.name ?? null,
        }));

        if (sessions.length) {
            groups.push({ termStartDate: term.startDate, grid: term.timeGrid, sessions });
        }
    }

    return buildIcs(groups, tenant.timezone);
}
