import { z } from 'zod';
import { mapDbErrors } from '../../../utils/dbErrors';
import { requirePermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';
import { assertExamKind, assertLeadsOffering, assertPlacementFits, assertTeachingComplete } from '../../../utils/examRequests';

const bodySchema = z.object({
    offeringId: z.string().min(1),
    kindId: z.string().min(1),
    termWeek: z.number().int().min(1),
    dayOfWeek: z.number().int().min(1).max(7),
    blockIndex: z.number().int().min(0),
    durationBlocks: z.number().int().min(1).default(1),
    /** A preference. Nothing is held while the request is pending. */
    roomId: z.string().min(1).nullish(),
    note: z.string().max(2000).nullish(),
});

/**
 * A lecturer asks for an exam on a module they lead.
 *
 * UNDER `/api/me/`, and the path is the enforcement rather than a convention.
 * The route takes no person id, not in the URL, not in the body, so another
 * Person's request is UNNAMEABLE rather than merely rejected. That is the same
 * shape `/api/me/availability` uses, and it is why a self-scoped route needs no
 * "is this me" check to get wrong.
 *
 * CREATES NOTHING SCHEDULED. The row is a request; the exam exists only after
 * somebody with `exam.review` approves it. That is the entire difference
 * between this and `POST /api/sessions`, which needs `session.create`, a key
 * that creates a Session anywhere, for anyone, immediately.
 */
export default defineEventHandler(async (event) => {
    const body = await readValidatedBody(event, bodySchema.parse);

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'exam.request_own');

        const offering = await tx.offering.findFirst({
            where: { id: body.offeringId, tenantId: identity.tenantId },
            select: { termId: true },
        });

        if (!offering) {
            throw createError({ statusCode: 404, statusMessage: 'Module not found.' });
        }

        // Ownership, kind and placement, in that order: the least informative
        // failure first, so a caller probing for modules learns nothing from
        // which error they get.
        await assertLeadsOffering(tx, identity, body.offeringId, offering.termId);
        await assertExamKind(tx, identity.tenantId, body.kindId);

        const term = await tx.term.findFirstOrThrow({
            where: { id: offering.termId, tenantId: identity.tenantId },
            select: { id: true, timeGridId: true, startDate: true, endDate: true },
        });

        await assertPlacementFits(tx, identity.tenantId, term, body);

        const created = await mapDbErrors(() => tx.examRequest.create({
            data: {
                tenantId: identity.tenantId,
                offeringId: body.offeringId,
                termId: term.id,
                kindId: body.kindId,
                termWeek: body.termWeek,
                dayOfWeek: body.dayOfWeek,
                blockIndex: body.blockIndex,
                durationBlocks: body.durationBlocks,
                roomId: body.roomId ?? null,
                note: body.note ?? null,
                // NEVER from the body. The acting Person is the requester by
                // definition, and accepting one would make the self-scoping
                // above decorative.
                requestedByPersonId: identity.actorPersonId,
            },
        }));

        // Warn, don't block: an exam can be requested before every Session of
        // the module's own teaching plan is placed: this is a fact for the
        // reviewer to weigh, not a reason to refuse the request.
        const teachingComplete = await assertTeachingComplete(tx, identity.tenantId, body.offeringId);

        return { request: created, teachingComplete };
    });
});
