import { requirePermission } from '../../../utils/requirePermission';
import { assertTeachingComplete, classifyTermWeeks } from '../../../utils/examRequests';
import type { TeachingCompleteness } from '../../../utils/examRequests';
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

    // ISSUE #101 — see the review queue's own comment (`exam-requests/index.get.ts`):
    // same fix, same reason. A lecturer asking for an exam should be able to
    // see, for any of their own pending requests, whether the module's
    // teaching plan is actually fully placed yet — not only learn it once, as
    // a side effect of the request they already submitted.
    const byOffering = new Map<string, TeachingCompleteness>();

    const withWeekKind = [];

    for (const row of rows) {
        if (!byTerm.has(row.termId)) {
            byTerm.set(row.termId, await classifyTermWeeks(tx, identity.tenantId, row.termId));
        }

        if (!byOffering.has(row.offeringId)) {
            byOffering.set(row.offeringId, await assertTeachingComplete(tx, identity.tenantId, row.offeringId));
        }

        withWeekKind.push({
            ...row,
            weekKind: byTerm.get(row.termId)?.find((w) => w.week === row.termWeek)?.kind ?? 'UNSPECIFIED',
            teachingComplete: byOffering.get(row.offeringId) as TeachingCompleteness,
        });
    }

    return { rows: withWeekKind };
}));
