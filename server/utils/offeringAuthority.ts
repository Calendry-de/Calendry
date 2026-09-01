import type { SchedulingPattern } from '@prisma/client';
import type { Tx } from './tenantDb';
import type { TenantScopedIdentity } from './tenantResolver';

/**
 * "Leads/lectures an Offering", the authority `assertLeadsOffering`
 * (`server/utils/examRequests.ts`) already established for exam requests —
 * duplicated here rather than shared because that function is scoped to a
 * TERM (an exam request always names one) and reports exam-specific wording,
 * while this one is not: a lecturer may repoint their module's pattern in any
 * term they still lead it, and the message names the actual capability
 * (issue #28) rather than exams.
 *
 * Same shape otherwise, and for the same reason: `OfferingLecturer` is the
 * one place "who leads this" is recorded (TAXONOMY.md), so a role or a
 * global "is this Person a lecturer anywhere" check would let any lecturer
 * repoint every OTHER lecturer's module.
 */
export async function assertLecturesOffering(
    tx: Tx,
    identity: TenantScopedIdentity,
    offeringId: string,
): Promise<{ id: string; title: string; schedulingPattern: SchedulingPattern | null }> {
    /*
     * `actorPersonId` is null for a screen key and for the poller, and
     * `heldPermissions()` already refuses those before this runs. Checked
     * again here rather than assumed: this function decides ownership, and
     * "no acting person" must never resolve to "leads everything" through an
     * `undefined` filter.
     */
    if (!identity.actorPersonId) {
        throw createError({ statusCode: 403, statusMessage: 'Only a signed-in person can set this.' });
    }

    const offering = await tx.offering.findFirst({
        where: {
            id: offeringId,
            tenantId: identity.tenantId,
            lecturers: { some: { personId: identity.actorPersonId } },
        },
        select: { id: true, title: true, schedulingPattern: true },
    });

    /*
     * 404, not 403, and deliberately the same answer as "no such Offering". A
     * distinct 403 would turn this route into a way to enumerate which
     * modules exist and who leads them, which is more than the holder of
     * `offering.set_scheduling_pattern` is being given.
     */
    if (!offering) {
        throw createError({
            statusCode: 404,
            statusMessage: 'No module you teach has that id.',
        });
    }

    return offering;
}
