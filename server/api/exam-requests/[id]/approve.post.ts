import { z } from 'zod';
import { mapDbErrors } from '../../../utils/dbErrors';
import { requirePermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';
import { assertExamRoomCapacity, assertPlacementFits, assertTeachingComplete, materializeExam } from '../../../utils/examRequests';

const bodySchema = z.object({ note: z.string().max(2000).nullish() });

/**
 * Approve a request, which is what CREATES the exam.
 *
 * AN EXPLICIT VERB, not a PATCH of `status`, matching how Session editing works
 * here: the interesting thing is not that a column changed, it is that a
 * Session came into existence, and the event log should record the intent
 * rather than the field.
 *
 * IDEMPOTENT BY REFUSAL, not by retry. A second approval is rejected rather
 * than quietly returning the first result, because the two are
 * indistinguishable to the caller and only one of them means "nothing further
 * happened". The database backs this up: `exam_request_session_matches_status`
 * makes an APPROVED row without a Session unrepresentable.
 */
export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id');
    const body = await readValidatedBody(event, bodySchema.parse);

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'exam.review');

        const request = await tx.examRequest.findFirst({
            where: { id, tenantId: identity.tenantId },
        });

        if (!request) {
            throw createError({ statusCode: 404, message: 'Exam request not found.' });
        }

        if (request.status !== 'PENDING') {
            throw createError({
                statusCode: 409,
                message: `This request was already ${request.status.toLowerCase()}.`,
                data: { status: request.status, sessionId: request.sessionId },
            });
        }

        /**
         * RE-CHECKED AT APPROVAL, not trusted from creation. A request can sit
         * pending while the term's grid is edited or its dates move, and a
         * placement that fitted when it was asked for may resolve to no slot by
         * the time it is granted. Creating the Session anyway would put it
         * outside the grid, which is the one thing `fitsGrid` exists to refuse.
         */
        const term = await tx.term.findFirstOrThrow({
            where: { id: request.termId, tenantId: identity.tenantId },
            select: { id: true, timeGridId: true, startDate: true, endDate: true },
        });

        await assertPlacementFits(tx, identity.tenantId, term, request);

        const { sessionId } = await mapDbErrors(() => materializeExam(event, tx, identity, request));

        const decided = await tx.examRequest.update({
            where: { id: request.id },
            data: {
                status: 'APPROVED',
                decidedByPersonId: identity.actorPersonId,
                decidedAt: new Date(),
                decisionNote: body.note ?? null,
                sessionId,
            },
        });

        // Warn, don't block: approval already happened above. This is
        // reported alongside it, not gated on it: the module's teaching plan
        // being incomplete does not make the exam any less approved.
        const teachingComplete = await assertTeachingComplete(tx, identity.tenantId, request.offeringId);

        // Same convention: a preferred room too small for the expected exam
        // sitting is reported, not refused: `roomId` was only ever a
        // preference, and the reviewer already chose to grant the request.
        const examCapacity = await assertExamRoomCapacity(tx, identity.tenantId, request.offeringId, request.roomId);

        return {
            request: decided, sessionId, teachingComplete, examCapacity,
        };
    });
});
