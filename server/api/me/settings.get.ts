import { withRequestTenant } from '../../utils/tenantDb';

/**
 * The signed-in Person's own display preferences (issue #17's `locale`,
 * `timezone` added alongside it). Self-service, no permission beyond being
 * signed in: this reads and writes only the caller's own row, never anyone
 * else's. Both are DISPLAY-ONLY (TAXONOMY.md §8): neither ever reaches grid
 * resolution or constraint evaluation, which stay tenant-local.
 */
export default defineEventHandler(async (event) => withRequestTenant(event, async (tx, identity) => {
    if (!identity.actorPersonId) {
        // Only an `account` identity has one (CLAUDE.md's three-principal
        // model); a screen or the poller has no "my settings" to have.
        throw createError({ statusCode: 403, statusMessage: 'No acting person on this request.' });
    }

    const person = await tx.person.findUnique({
        where: { id: identity.actorPersonId },
        select: { locale: true, timezone: true },
    });

    return { locale: person?.locale ?? null, timezone: person?.timezone ?? null };
}));
