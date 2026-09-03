import { holidaySchema, resolveHolidayRange, tenantTerms } from '../../../utils/availability';
import { mapDbErrors } from '../../../utils/dbErrors';
import { requirePermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';

/**
 * Declare a date-range absence for YOURSELF: "I am away from the 14th".
 *
 * The second entry mode, alongside the recurring weekly pattern next door, and
 * deliberately its own route rather than a flag on that one. They take different
 * inputs (two dates versus two axis selections), fail in different ways (a range
 * outside every term versus a block index off the grid) and mean different
 * things. One route with a mode switch would be two implementations sharing a
 * door.
 *
 * DATES IN, WEEKS OUT. The client never computes week indices: that arithmetic
 * is `weekIndexOf`, and this project has already had to unify two copies of it
 * that agreed until they did not. The term is derived from the dates too, so
 * nobody has to know which academic term contains their holiday.
 *
 * PENDING like every self-declared window: a veto is a HARD constraint, and a
 * fortnight of one is a bigger hole in the timetable than a Friday afternoon,
 * not a smaller one.
 */
export default defineEventHandler(async (event) => {
    const body = await readValidatedBody(event, holidaySchema.parse);

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'availability.manage_own');

        const personId = identity.actorPersonId;

        if (!personId) {
            throw createError({ statusCode: 403, message: 'No acting Person on this session.' });
        }

        const terms = await tenantTerms(tx, identity.tenantId);
        const { term, resolution } = resolveHolidayRange(terms, new Date(body.startDate), new Date(body.endDate));

        const created = await mapDbErrors(() => tx.personUnavailability.create({
            data: {
                tenantId: identity.tenantId,
                personId,
                // Every touched week, whole, as every reader of the row lists
                // and counts it. NOT what reaches the solver for this row: the
                // dates below are expanded to the exact days at the read path.
                days: [],
                blocks: [],
                weeks: resolution.weeks,
                // The real dates (issue #118). `approvedBlackoutsFor` expands
                // them into day-precise windows; `weeks` above stays the
                // whole-week list every reader of the row already understands.
                absentFrom: new Date(body.startDate),
                absentTo: new Date(body.endDate),
                termId: term.id,
                reason: body.reason ?? null,
                status: 'PENDING',
                createdByPersonId: personId,
            },
            select: { id: true, status: true, weeks: true, absentFrom: true, absentTo: true },
        }));

        setResponseStatus(event, 201);

        return { ...created, term: { id: term.id, name: term.name }, touched: resolution.touched };
    });
});
