import { z } from 'zod';
import { requirePermission } from '../../utils/requirePermission';
import { assertTeachingComplete, classifyTermWeeks } from '../../utils/examRequests';
import type { TeachingCompleteness } from '../../utils/examRequests';
import { withRequestTenant } from '../../utils/tenantDb';

const querySchema = z.object({
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
});

/**
 * The review queue.
 *
 * `exam.review` and NOT `exam.request_own`: this returns everybody's requests,
 * so holding the key that lets you ask for your own must not let you read the
 * institution's. The lecturer's own list is `/api/me/exam-requests`, which is a
 * different route because it answers a different question.
 */
export default defineEventHandler(async (event) => {
    const query = await getValidatedQuery(event, querySchema.parse);

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'exam.review');

        const rows = await tx.examRequest.findMany({
            where: {
                tenantId: identity.tenantId,
                ...(query.status ? { status: query.status } : {}),
            },
            orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
            include: {
                offering: { select: { id: true, title: true, code: true } },
                kind: { select: { id: true, name: true } },
                room: { select: { id: true, name: true, code: true } },
                term: { select: { id: true, name: true } },
                requestedBy: { select: { id: true, givenName: true, familyName: true } },
                decidedBy: { select: { id: true, givenName: true, familyName: true } },
            },
        });

        /*
     * The week's KIND, resolved per Term rather than stored on the row: a
     * request outlives the calendar it was made against, and a period edited
     * afterwards must change what the row reads as. Cached per Term because a
     * queue is overwhelmingly one or two of them.
     */
    const byTerm = new Map<string, { week: number; kind: string }[]>();

    /*
     * ISSUE #101. `assertTeachingComplete` used to run ONLY inside
     * `POST .../approve`'s response: a fact shown once, as a side effect of
     * the very decision it should have informed, then gone. A reviewer
     * scanning the pending queue saw nothing distinguishing a module whose
     * teaching plan is fully placed from one that is not, which is the
     * moment this fact is actually useful. Cached per Offering for the same
     * reason `byTerm` is cached per Term: a queue is overwhelmingly a handful
     * of modules asking more than once.
     */
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
    });
});
