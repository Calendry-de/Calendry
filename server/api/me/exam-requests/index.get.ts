import { requirePermission } from '../../../utils/requirePermission';
import { classifyTermWeeks } from '../../../utils/examRequests';
import { withRequestTenant } from '../../../utils/tenantDb';

/**
 * The requests this person made.
 *
 * Filtered on `actorPersonId` rather than on a parameter, matching the POST
 * beside it: there is no id to pass, so there is no id to get wrong.
 */
export default defineEventHandler(async (event) => withRequestTenant(event, async (tx, identity) => {
    await requirePermission(event, tx, 'exam.request_own');

    const rows = await tx.examRequest.findMany({
        where: { tenantId: identity.tenantId, requestedByPersonId: identity.actorPersonId },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        include: {
            offering: { select: { id: true, title: true, code: true } },
            kind: { select: { id: true, name: true } },
            room: { select: { id: true, name: true, code: true } },
        },
    });

    /*
     * The week's KIND, resolved per Term rather than stored on the row: a
     * request outlives the calendar it was made against, and a period edited
     * afterwards must change what the row reads as. Cached per Term because a
     * queue is overwhelmingly one or two of them.
     */
    const byTerm = new Map<string, { week: number; kind: string }[]>();

    const withWeekKind = [];

    for (const row of rows) {
        if (!byTerm.has(row.termId)) {
            byTerm.set(row.termId, await classifyTermWeeks(tx, identity.tenantId, row.termId));
        }

        withWeekKind.push({
            ...row,
            weekKind: byTerm.get(row.termId)?.find((w) => w.week === row.termWeek)?.kind ?? 'UNSPECIFIED',
        });
    }

    return { rows: withWeekKind };
}));
