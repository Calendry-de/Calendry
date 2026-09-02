import { z } from 'zod';
import { requirePermission } from '../../../../utils/requirePermission';
import { withRequestTenant } from '../../../../utils/tenantDb';

const BODY = z.object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    note: z.string().trim().max(500).nullish(),
});

/**
 * Approve or reject one submitted window.
 *
 * ONE route carrying the decision rather than `/approve` and `/reject`, which
 * is a deliberate departure from the Session verb convention. There the verbs
 * are different OPERATIONS with different payloads and different events
 * (`move`, `swap`, `lock`); here they are two values of one field, written by
 * one statement, differing only in which enum value lands. Two routes would be
 * one implementation copied, and the copy is where they drift.
 *
 * DECIDING IS IDEMPOTENT-BY-REFUSAL, not by overwrite: only a PENDING row can
 * be decided. Re-deciding an approved window would silently rewrite who
 * approved it and when, and a reviewer clicking twice on a stale list would
 * quietly take ownership of somebody else's decision, so the second click gets
 * 409 naming the current status instead.
 */
export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id');
    const body = await readValidatedBody(event, BODY.parse);

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'availability.manage_any');

        const row = await tx.personUnavailability.findFirst({
            where: { id, tenantId: identity.tenantId },
            select: { id: true, status: true },
        });

        if (!row) {
            throw createError({ statusCode: 404, message: 'Not found.' });
        }

        if (row.status !== 'PENDING') {
            throw createError({
                statusCode: 409,
                message: `This window was already ${row.status.toLowerCase()}. `
                    + 'Delete it and ask for a new submission rather than re-deciding it.',
            });
        }

        return tx.personUnavailability.update({
            where: { id: row.id },
            data: {
                status: body.decision,
                decidedByPersonId: identity.actorPersonId,
                decidedAt: new Date(),
                // Kept for approvals too, since a reviewer may want to record why
                // they let an unusual window through, and dropping the note on
                // one branch would make its absence ambiguous.
                decisionNote: body.note ?? null,
            },
            select: { id: true, status: true, decidedAt: true },
        });
    });
});
