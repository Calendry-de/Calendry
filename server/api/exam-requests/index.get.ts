import { z } from 'zod';
import { requirePermission } from '../../utils/requirePermission';
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

        return { rows };
    });
});
