import { z } from 'zod';
import { requirePermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';

const bodySchema = z.object({ note: z.string().max(2000).nullish() });

/**
 * Reject a request. Creates nothing, which is the whole difference from
 * approving one: `session_id` stays NULL and the database's
 * `exam_request_session_matches_status` CHECK enforces that it must.
 *
 * The row is kept rather than deleted: "we asked and were told no" is the
 * answer a lecturer needs next term, and a deleted request answers nothing.
 */
export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id');
    const body = await readValidatedBody(event, bodySchema.parse);

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'exam.review');

        const request = await tx.examRequest.findFirst({
            where: { id, tenantId: identity.tenantId },
            select: { id: true, status: true },
        });

        if (!request) {
            throw createError({ statusCode: 404, statusMessage: 'Exam request not found.' });
        }

        if (request.status !== 'PENDING') {
            throw createError({
                statusCode: 409,
                statusMessage: `This request was already ${request.status.toLowerCase()}.`,
                data: { status: request.status },
            });
        }

        const decided = await tx.examRequest.update({
            where: { id: request.id },
            data: {
                status: 'REJECTED',
                decidedByPersonId: identity.actorPersonId,
                decidedAt: new Date(),
                decisionNote: body.note ?? null,
            },
        });

        return { request: decided };
    });
});
