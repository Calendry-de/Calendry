import { addDays } from '../../../shared/academicCalendar';
import { isPlacedSession } from '../../../shared/sessionPlacement';
import type { ExportSession, ExportTermGroup } from '../../utils/icalExport';
import { buildIcs, weekRangeOf } from '../../utils/icalExport';
import { ownSessionClause } from '../../utils/scheduleScope';
import { localNow } from '../../utils/solverCalendar';
import { withTenant } from '../../utils/tenantDb';
import { icsLinkResolver } from '../../utils/tenantResolver';

defineRouteMeta({
    openAPI: {
        tags: ['Calendar links'],
        summary: 'Stream one Person’s own Sessions as a subscribable .ics feed',
        description: 'The stream half of issue #15 — a calendar app fetches this on its own schedule, unlike GET /api/me/schedule.ics which no longer exists. Identified by the ics_link token in the query string alone; there is no session and no permission check, only the link’s own scope (ALL, bounded to its stored weeksAhead window, or one TERM in full). Public in the sense that `/api/screens/board` is: reachable with no cookie, because the token in the query string IS the credential — see tenant-context.ts.',
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
        const own = await ownSessionClause(tx, identity);
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

        const ics = buildIcs(groups, tenant.timezone);

        setResponseHeader(event, 'content-type', 'text/calendar; charset=utf-8');
        // Deliberately NOT `content-disposition: attachment` — this is a feed
        // a calendar app re-fetches in place, not a file a browser saves once.

        return ics;
    });
});
