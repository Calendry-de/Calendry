import { z } from 'zod';
import { holidaySchema, resolveHolidayRange, tenantTerms } from '../../../utils/availability';
import { mapDbErrors } from '../../../utils/dbErrors';
import { requirePermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';

const BODY = holidaySchema.extend({ personId: z.string().min(1) });

/**
 * An administrator records a date-range absence for somebody — APPROVED on
 * arrival, like every other window they enter directly.
 *
 * The same resolution as the self-service route, through the same function: an
 * administrator's holiday must land on the same weeks a lecturer's would, and
 * two call sites of one resolver is what guarantees that rather than two
 * implementations that happen to agree today.
 */
export default defineEventHandler(async (event) => {
    const body = await readValidatedBody(event, BODY.parse);

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'availability.manage_any');

        const person = await tx.person.findFirst({
            where: { id: body.personId, tenantId: identity.tenantId },
            select: { id: true },
        });

        if (!person) {
            throw createError({ statusCode: 404, statusMessage: 'Not found.' });
        }

        const terms = await tenantTerms(tx, identity.tenantId);
        const { term, resolution } = resolveHolidayRange(terms, new Date(body.startDate), new Date(body.endDate));

        const created = await mapDbErrors(() => tx.personUnavailability.create({
            data: {
                tenantId: identity.tenantId,
                personId: person.id,
                days: [],
                blocks: [],
                weeks: resolution.weeks,
                termId: term.id,
                reason: body.reason ?? null,
                status: 'APPROVED',
                createdByPersonId: identity.actorPersonId,
                decidedByPersonId: identity.actorPersonId,
                decidedAt: new Date(),
            },
            select: { id: true, status: true, weeks: true },
        }));

        setResponseStatus(event, 201);

        return { ...created, term: { id: term.id, name: term.name }, touched: resolution.touched };
    });
});
