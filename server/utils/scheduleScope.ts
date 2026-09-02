import type { H3Event } from 'h3';
import type { TenantScopedIdentity } from './tenantResolver';
import type { Tx } from './tenantDb';
import { ancestorGroupIds } from './groupClosure';
import { holdsPermission, requireAnyPermission } from './requirePermission';

/**
 * Who may read the timetable, and how much of it.
 *
 * TWO PERMISSIONS, ONE ROUTE. `session.read` is the whole institution's
 * schedule; `session.read_own` is the caller's own sessions and nothing else.
 * The difference is a WHERE clause rather than a status code, so both keys reach
 * the same handlers and this module is the single place that decides which
 * answer they get.
 *
 * WRITTEN ONCE, DELIBERATELY. `GET /api/sessions` and `GET /api/schedule/context`
 * must agree exactly: the context endpoint names the rooms, people and groups
 * appearing in the sessions the caller can see, so if the two disagreed about
 * what "can see" means, either a chip would render with an unresolvable id
 * (harmless, visible) or a name would be published for a session the caller
 * cannot read (not harmless, invisible). One function, both callers.
 */

/** Both keys, in the order a denial message should name them. */
export const SESSION_READ_PERMISSIONS = ['session.read', 'session.read_own'] as const;

export interface SessionReadScope {
    /** `any` sees the institution's whole timetable; `own` sees their own. */
    scope: 'any' | 'own';
    /**
     * The ownership + visibility predicate, ready to spread into a `where`.
     *
     * Always includes the tenant/federation ownership clause, because a shared
     * Session must appear on every member tenant's timetable (Stage 7c) and RLS
     * permits that read without ever asking for it.
     */
    where: Record<string, unknown>;
}

/**
 * Resolves what this caller may see, refusing outright if they hold neither key.
 *
 * `requireAnyPermission` FIRST and unconditionally: narrowing on the result of a
 * bare `holdsPermission` would make "holds neither" fall into the `own` branch,
 * which answers a smaller shape of the data instead of refusing.
 */
export async function sessionReadScope(
    event: H3Event,
    tx: Tx,
    identity: TenantScopedIdentity,
): Promise<SessionReadScope> {
    await requireAnyPermission(event, tx, SESSION_READ_PERMISSIONS);

    const ownership = {
        OR: [
            { tenantId: identity.tenantId },
            ...(identity.federationId ? [{ federationId: identity.federationId }] : []),
        ],
    };

    if (await holdsPermission(event, tx, 'session.read')) {
        return { scope: 'any', where: ownership };
    }

    return { scope: 'own', where: { AND: [ownership, await ownSessionClause(tx, identity)] } };
}

/**
 * "Sessions this person is in."
 *
 * THREE WAYS TO BE IN ONE, and all three are needed:
 *
 *   1. ATTACHED DIRECTLY (`session_person`): the lecturer leading it, and
 *      anybody named on it individually. This is the case a naive
 *      implementation gets right.
 *   2. THROUGH A GROUP, walking UP the hierarchy. A Session assigned to a Cohort
 *      is attended by everyone in that Cohort's Seminars (attendance flows DOWN;
 *      TAXONOMY.md §6), so the question "is this session mine" starts from the
 *      Groups I am a MEMBER of and asks whether the Session names one of them or
 *      any of their ANCESTORS.
 *   3. COVERING IT (`session_substitution`, issue #30). The substitute is never
 *      written into `session_person` (the original lecturer's row survives
 *      untouched, see the model's own comment), so without this branch a
 *      substitute's OWN timetable would not show the Session they are standing
 *      in for, which is the entire point of `session.read_own` existing.
 *
 * Getting direction 2 backwards is the failure this codebase has already met in
 * `violations.ts`: `descendantGroupIds` here would show a Cohort member every
 * one of its Seminars' private sessions, and it would look correct on any
 * fixture with a flat group list.
 *
 * A person with no memberships and no attachments matches NOTHING, which is the
 * honest answer: an empty timetable, not everybody's.
 *
 * EXPORTED for the iCal export (issue #15), which must not invent a second
 * answer to "which Sessions are mine" (the card's own words). That export is
 * ALWAYS the caller's own slice, never `sessionReadScope`'s `any` branch, so it
 * calls this directly rather than going through the read-permission switch
 * above.
 */
export async function ownSessionClause(tx: Tx, identity: TenantScopedIdentity): Promise<Record<string, unknown>> {
    const personId = identity.actorPersonId;

    if (!personId) {
        /*
         * No acting Person means no "own" to scope to. `requireAnyPermission`
         * has already refused this case (it needs an actor to load permissions
         * at all), so this is unreachable, and it fails CLOSED rather than
         * returning an unscoped clause, because the one thing this must never do
         * is widen.
         */
        throw createError({ statusCode: 403, message: 'No acting Person on this session.' });
    }

    const memberships = await tx.membership.findMany({
        where: { personId, tenantId: identity.tenantId },
        select: { groupId: true },
    });

    const attendedGroupIds = await ancestorGroupIds(tx, memberships.map((row) => row.groupId));

    return {
        OR: [
            { people: { some: { personId } } },
            ...(attendedGroupIds.length
                ? [{ groups: { some: { groupId: { in: attendedGroupIds } } } }]
                : []),
            { substitution: { coveringPersonId: personId } },
        ],
    };
}

/**
 * "Sessions belonging to these Groups": the calendar-link equivalent of
 * `ownSessionClause`'s Group branch (issue #115), for a link that names
 * explicit Groups instead of streaming its creator's own Sessions.
 *
 * SAME ANCESTOR WALK, deliberately: a Group's own calendar must show a
 * Session assigned to one of its ANCESTORS too (a cohort-wide lecture reaches
 * its seminars; TAXONOMY.md §6, attendance flows DOWN), which is exactly
 * what a MEMBER of that Group would see via `ownSessionClause`. This omits
 * `ownSessionClause`'s other two branches on purpose: there is no specific
 * Person here to attach a direct `session_person` row or a substitution to.
 *
 * `groupIds` must already be validated as belonging to the caller's tenant:
 * this function does not re-check that.
 */
export async function groupSessionClause(tx: Tx, groupIds: string[]): Promise<Record<string, unknown>> {
    const attendedGroupIds = await ancestorGroupIds(tx, groupIds);

    return { groups: { some: { groupId: { in: attendedGroupIds } } } };
}
