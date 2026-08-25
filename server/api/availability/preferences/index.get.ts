import { tenantGridLimits } from '../../../utils/availability';
import { requireAnyPermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';

/**
 * Everyone in the tenant, with their preferences — the administrator overview.
 *
 * DRIVEN BY THE PEOPLE, NOT BY THE PREFERENCE ROWS. A list of the rows that
 * exist answers "who has set preferences"; the question an administrator
 * actually has is "who has, and who has not", and those are different lists.
 * Omitting the people with no row is the same shape of omission that let a
 * missing constraint type look like a complete catalogue.
 *
 * Names and the grid travel with the response for the reason every page in this
 * area does it: fetching `/api/persons` or `/api/time-grids` alongside would
 * need permissions this page is not gated on, and one refused fetch inside a
 * reference wave renders the whole page's controls over empty data.
 */
export default defineEventHandler(async (event) => withRequestTenant(event, async (tx, identity) => {
    await requireAnyPermission(event, tx, ['availability.manage_any', 'availability.read_any']);

    const [people, limits] = await Promise.all([
        tx.person.findMany({
            where: { tenantId: identity.tenantId, isActive: true },
            orderBy: [{ familyName: 'asc' }, { givenName: 'asc' }],
            take: 500,
            select: {
                id: true,
                givenName: true,
                familyName: true,
                preference: { select: { preferredDays: true, preferredBlocks: true } },
                personRoles: { select: { role: { select: { key: true, name: true } } } },
            },
        }),
        tenantGridLimits(tx, identity.tenantId),
    ]);

    return {
        grid: limits.defaultGrid,
        maxBlocksPerDay: limits.blocksPerDay,
        people: people.map((person) => ({
            id: person.id,
            givenName: person.givenName,
            familyName: person.familyName,
            roles: person.personRoles.map((link) => link.role.key),
            // `null` when no row exists, which IS the "no preference" state —
            // see the model comment. Synthesising empty arrays here would erase
            // the distinction the write path works to keep single-valued.
            preference: person.preference,
        })),
    };
}));
