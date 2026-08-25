import { blockedSlotSummary } from '../../../shared/availability';
import { tenantGridLimits, tenantTerms } from '../../utils/availability';
import { requirePermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

/**
 * Everything the self-service availability page renders, under ONE permission.
 *
 * THE PERSON ID IS NOT A PARAMETER — not in the path, not in the query, not in
 * the body. It comes from the resolved session identity, exactly as `tenant_id`
 * does on every write route. That is what "self-scoped" means here: another
 * Person's row is unnameable rather than merely rejected, so there is no check
 * to forget.
 *
 * THE GRID TRAVELS WITH THE RESPONSE, and that is not padding. A `/my` page
 * that fetched `/api/time-grids` separately would 403 for a lecturer holding
 * only `availability.manage_own` — one refused fetch inside a `Promise.all`
 * takes the whole wave down, and the page renders empty controls over real data.
 * Same fix as Stage 6c, where offering names started travelling with the
 * preview response: everything a page needs arrives under the gate the page is
 * actually behind.
 */
export default defineEventHandler(async (event) => withRequestTenant(event, async (tx, identity) => {
    await requirePermission(event, tx, 'availability.manage_own');

    const personId = identity.actorPersonId;

    if (!personId) {
        throw createError({ statusCode: 403, statusMessage: 'No acting Person on this session.' });
    }

    const [rows, preference, limits, terms] = await Promise.all([
        tx.personUnavailability.findMany({
            where: { personId },
            orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
            select: {
                id: true,
                days: true,
                blocks: true,
                weeks: true,
                reason: true,
                status: true,
                decisionNote: true,
                decidedAt: true,
                createdAt: true,
                termId: true,
                term: { select: { name: true } },
            },
        }),
        tx.personPreference.findUnique({
            where: { personId },
            select: { preferredDays: true, preferredBlocks: true },
        }),
        tenantGridLimits(tx, identity.tenantId),
        tenantTerms(tx, identity.tenantId),
    ]);

    /*
     * Counted over APPROVED windows only, because that is what is actually in
     * force. A pending submission is inert, and folding it in would tell someone
     * they had blocked half their week before anybody agreed to it.
     */
    /*
     * Counted over APPROVED windows only, and over the RECURRING ones at that:
     * `blockedSlotSummary` sets week-scoped entries aside because a holiday is
     * not a standing block on the weekly grid, and folding a fortnight into
     * "N of 40 teaching slots" would state something nobody can reconcile with
     * what they entered.
     */
    const approved = rows.filter((row) => row.status === 'APPROVED');
    const grid = limits.defaultGrid;

    return {
        personId,
        grid,
        /*
         * Terms travel with the response so the holiday form can preview which
         * weeks a date range resolves to WITHOUT calling /api/terms, which needs
         * `term.read` — a permission the self-service role does not hold.
         */
        terms,
        maxBlocksPerDay: limits.blocksPerDay,
        vetoes: rows,
        // `null` rather than empty arrays: an absent row IS the "no preference"
        // state, and inventing a row shape here would hide that from the client.
        preference,
        blocked: grid
            ? blockedSlotSummary(approved, grid.activeDays, grid.blocksPerDay)
            : null,
    };
}));
