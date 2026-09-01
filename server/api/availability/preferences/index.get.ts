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

    // Sequential — `tx` is one shared connection; concurrent queries on it
    // trip pg's deprecated overlapping-query warning.
    const people = await tx.person.findMany({
        where: { tenantId: identity.tenantId, isActive: true },
        orderBy: [{ familyName: 'asc' }, { givenName: 'asc' }],
        take: 500,
        select: {
            id: true,
            givenName: true,
            familyName: true,
            preference: {
                select: {
                    preferredDays: true,
                    preferredBlocks: true,
                    weightMultiplier: true,
                    roomFeatures: { select: { equipmentId: true } },
                },
            },
            personRoles: { select: { role: { select: { key: true, name: true } } } },
        },
    });
    const limits = await tenantGridLimits(tx, identity.tenantId);
    /*
     * Travels with the page, not fetched from `/api/equipment`. This route's
     * gate is `availability.manage_any`/`read_any`, which does not imply
     * `equipment.read` — and one 403 inside a reference fetch blanks the
     * whole screen with no error, the least diagnosable failure a UI has.
     */
    const roomFeatureOptions = await tx.equipment.findMany({
        orderBy: { name: 'asc' },
        take: 200,
        select: { id: true, key: true, name: true },
    });

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
            // Flattened to ids, so the client never sees the join shape. Still
            // `null` when there is no row.
            preference: person.preference && {
                preferredDays: person.preference.preferredDays,
                preferredBlocks: person.preference.preferredBlocks,
                weightMultiplier: person.preference.weightMultiplier,
                preferredRoomFeatureIds: person.preference.roomFeatures.map((link) => link.equipmentId),
            },
        })),
        roomFeatureOptions,
    };
}));
