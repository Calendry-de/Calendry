import { withRequestTenant } from '../../utils/tenantDb';

const TRACKED = {
    preferencesWeighed: 'person_preference_fit',
    groupAvailabilityHonoured: 'group_veto',
} as const;

/**
 * Whether the institution currently WEIGHS what a lecturer states about
 * themselves — issue #3.
 *
 * NO NEW PERMISSION, deliberately. `constraint.read` is an administrator's
 * key and exposes the whole configured rule set — every weight, every
 * parameter, every scope. This answers a narrower question with a plain
 * boolean and nothing else, so the one thing gating it is CLAUDE.md's own
 * architecture rule: only the `account` principal has an acting Person at
 * all, and a screen key or the poller cannot reach this route no matter what
 * they hold, because `identity.actorPersonId` is structurally null for both.
 * There is nothing narrower to grant, so nothing new is minted to grant it.
 *
 * BOOLEANS ONLY. `/my/preferences` used to say "the scheduler can weigh
 * these" unconditionally, which was true only once solver support landed and
 * false again the moment a tenant switches the rule off — a policy fact the
 * page could not resolve without `constraint.read`. Reading the row directly
 * here, server-side, answers it without the caller ever seeing a weight, a
 * name, or which OTHER rules exist.
 *
 * "NO ROW" READS AS false, same as an explicitly disabled one — both mean
 * "not currently weighed" from a reader who cannot act on the distinction
 * either way. This differs from the Group-availability editor's own fix,
 * which DOES distinguish "absent" from "off" — but that fix is for an
 * ADMINISTRATOR deciding whether to configure the rule; this is for a
 * LECTURER who can do nothing with either answer but note it.
 */
export default defineEventHandler(async (event) => withRequestTenant(event, async (tx, identity) => {
    if (!identity.actorPersonId) {
        throw createError({ statusCode: 403, statusMessage: 'No acting Person on this session.' });
    }

    const rows = await tx.constraint.findMany({
        where: { tenantId: identity.tenantId, type: { in: Object.values(TRACKED) } },
        select: { type: true, isEnabled: true },
    });

    const enabledByType = new Map(rows.map((row) => [row.type, row.isEnabled]));

    return Object.fromEntries(
        Object.entries(TRACKED).map(([key, type]) => [key, enabledByType.get(type) ?? false]),
    ) as Record<keyof typeof TRACKED, boolean>;
}));
