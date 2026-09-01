import { z } from 'zod';
import { tenantGridLimits, tenantTerms } from '../../../utils/availability';
import { requireAnyPermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';

const QUERY = z.object({
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
    personId: z.string().min(1).optional(),
});

/**
 * The review queue, and the tenant-wide view behind it.
 *
 * Readable with EITHER administration permission: `manage_any` obviously, and
 * `read_any` because a scheduler who may see who is unavailable without being
 * able to change it is a real role — that split is why `read_any` exists as its
 * own key rather than being implied.
 *
 * EVERYTHING THE PAGE NEEDS TRAVELS WITH IT — the rows, the people to pick from
 * when entering one, the grid to name blocks and the terms to resolve dates
 * against. The alternatives are `/api/persons`, `/api/time-grids` and
 * `/api/terms`, which need three permissions this page is not gated on, and one
 * refused fetch in a reference wave renders every control over empty data.
 *
 * The response is an OBJECT rather than the bare array it was, because the page
 * grew an entry form and a form needs more than the queue does.
 */
export default defineEventHandler(async (event) => {
    const query = await getValidatedQuery(event, QUERY.parse);

    return withRequestTenant(event, async (tx, identity) => {
        await requireAnyPermission(event, tx, ['availability.manage_any', 'availability.read_any']);

        // Sequential — `tx` is one shared connection; concurrent queries on it
        // trip pg's deprecated overlapping-query warning.
        const rows = await tx.personUnavailability.findMany({
            where: {
                tenantId: identity.tenantId,
                ...(query.status ? { status: query.status } : {}),
                ...(query.personId ? { personId: query.personId } : {}),
            },
            // Pending first, then newest: the queue's whole purpose is the
            // things still waiting, and burying them under decided history
            // would make the page's primary job its least visible one.
            orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
            take: 500,
            select: {
                id: true,
                personId: true,
                days: true,
                blocks: true,
                weeks: true,
                termId: true,
                term: { select: { name: true } },
                reason: true,
                status: true,
                decisionNote: true,
                decidedAt: true,
                createdAt: true,
                person: { select: { givenName: true, familyName: true } },
                createdBy: { select: { givenName: true, familyName: true } },
                decidedBy: { select: { givenName: true, familyName: true } },
            },
        });
        const people = await tx.person.findMany({
            where: { tenantId: identity.tenantId, isActive: true },
            orderBy: [{ familyName: 'asc' }, { givenName: 'asc' }],
            take: 500,
            select: { id: true, givenName: true, familyName: true },
        });
        const limits = await tenantGridLimits(tx, identity.tenantId);
        const terms = await tenantTerms(tx, identity.tenantId);

        return { rows, people, grid: limits.defaultGrid, terms };
    });
});
