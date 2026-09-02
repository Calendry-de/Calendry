import { z } from 'zod';
import { requirePermission } from '../../../../utils/requirePermission';
import { withRequestTenant } from '../../../../utils/tenantDb';
import { assertLecturesOffering } from '../../../../utils/offeringAuthority';

/*
 * '' IS NULL HERE, matching the admin write schema
 * (`RESOURCES.offerings.update` in `server/utils/resources.ts`): a `<select>`
 * cannot send "absent", it sends the empty string, and the one option that
 * means "not decided" must round-trip back to NULL rather than fail
 * validation.
 */
const bodySchema = z.object({
    schedulingPattern: z.preprocess(
        (value) => (value === '' ? null : value),
        z.enum(['DISTRIBUTED', 'BLOCK']).nullable(),
    ),
});

/**
 * A lecturer sets how THEIR OWN module is taught across the term (issue
 * #28), the same field an administrator already writes through
 * `PATCH /api/offerings/:id`, narrowed to a single field and to Offerings
 * the caller actually leads.
 *
 * AN EXPLICIT VERB rather than a body key on the generic PATCH route: the
 * generic route is gated on `offering.update`, a much wider authority (title,
 * groups, capacity, everything else an Offering is) that this feature must
 * not require. Session's editing operations are explicit verbs for the same
 * reason: the permission and the write have to name the same thing.
 *
 * CO-TAUGHT OFFERINGS: last write wins. Any Person currently in
 * `OfferingLecturer` for this module may set it; there is no vote and no
 * lock between two lecturers disagreeing, which is a deliberate choice to
 * avoid building a consensus mechanism nobody asked for.
 */
export default defineEventHandler(async (event) => {
    const offeringId = getRouterParam(event, 'id');

    if (!offeringId) {
        throw createError({ statusCode: 400, message: 'Missing offering id.' });
    }

    const body = await readValidatedBody(event, bodySchema.parse);

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'offering.set_scheduling_pattern');

        // Ownership checked against `OfferingLecturer`, never assumed from
        // holding the permission alone; see `assertLecturesOffering`.
        await assertLecturesOffering(tx, identity, offeringId);

        const updated = await tx.offering.update({
            where: { id: offeringId },
            data: { schedulingPattern: body.schedulingPattern },
            select: { id: true, title: true, schedulingPattern: true },
        });

        return { offering: updated };
    });
});
