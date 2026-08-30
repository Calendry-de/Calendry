import { z } from 'zod';
import { requireAnyPermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';
import { SESSION_READ_PERMISSIONS, ownSessionClause } from '../../utils/scheduleScope';
import { buildIcs, isoDate, weekRangeOf } from '../../utils/icalExport';
import type { ExportSession } from '../../utils/icalExport';

const querySchema = z.object({
    termId: z.string().min(1),
    /** Both optional; omitted means the whole Term. */
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * One Person's own Sessions in one Term, as a downloadable `.ics` — issue #15,
 * the one-off download half only. The subscribe-feed half needs a
 * link-identity answer this route does not: an authenticated download has no
 * identity question at all.
 *
 * SAME GATE AS THE SCHEDULE PAGE (`SESSION_READ_PERMISSIONS`), but ALWAYS the
 * "own" slice regardless of which of the two keys the caller holds —
 * `ownSessionClause` directly, not `sessionReadScope`'s any/own switch. A
 * personal export must not become a second way to read the whole
 * institution's timetable for whoever happens to hold the broader key.
 */
export default defineEventHandler(async (event) => {
    const query = await getValidatedQuery(event, querySchema.parse);

    return withRequestTenant(event, async (tx, identity) => {
        await requireAnyPermission(event, tx, SESSION_READ_PERMISSIONS);

        const term = await tx.term.findFirst({
            where: { id: query.termId, tenantId: identity.tenantId },
            include: { timeGrid: true },
        });

        if (!term) {
            throw createError({ statusCode: 404, statusMessage: 'Term not found.' });
        }

        if (!term.timeGrid) {
            throw createError({
                statusCode: 422,
                statusMessage: 'This Term has no TimeGrid configured, so there is nothing to resolve times against.',
            });
        }

        const own = await ownSessionClause(tx, identity);

        const range = query.from && query.to
            ? weekRangeOf(term.startDate, new Date(query.from), new Date(query.to))
            : null;

        const rows = await tx.session.findMany({
            where: {
                termId: term.id,
                AND: [own],
                ...(range ? { termWeek: { gte: range.first, lte: range.last } } : {}),
            },
            include: { offering: { select: { title: true } }, rooms: { include: { room: true } } },
            orderBy: [{ termWeek: 'asc' }, { dayOfWeek: 'asc' }, { blockIndex: 'asc' }],
        });

        // Mirrors `sessionLabel` (app/composables/schedule.ts) deliberately
        // rather than importing it: that module is client-side, and this is
        // the one place server code needs the same three-line rule.
        const sessions: ExportSession[] = rows.map((row) => ({
            id: row.id,
            termWeek: row.termWeek,
            dayOfWeek: row.dayOfWeek,
            blockIndex: row.blockIndex,
            durationBlocks: row.durationBlocks,
            title: row.offering?.title ?? row.title ?? 'Untitled event',
            location: row.rooms[0]?.room.name ?? null,
        }));

        const tenant = await tx.tenant.findUniqueOrThrow({
            where: { id: identity.tenantId },
            select: { timezone: true },
        });

        const ics = buildIcs(sessions, term.startDate, term.timeGrid, tenant.timezone);

        setResponseHeader(event, 'content-type', 'text/calendar; charset=utf-8');
        setResponseHeader(
            event,
            'content-disposition',
            `attachment; filename="schedule-${isoDate(new Date())}.ics"`,
        );

        return ics;
    });
});
