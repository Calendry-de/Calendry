import { z } from 'zod';
import { mapDbErrors } from '../../utils/dbErrors';
import { crudPermission } from '../../utils/permissions';
import { requireAnyPermission } from '../../utils/requirePermission';
import { type Tx, withRequestTenant } from '../../utils/tenantDb';

/**
 * The logins that exist in this institution.
 *
 * DRIVEN FROM `person`, NOT FROM `account`. `person` is behind RLS, so starting
 * there makes the tenant boundary a property of the query rather than a filter
 * this handler has to remember, the same reason every other read in this
 * codebase goes through `withTenant`. Starting from `account` (no RLS, no
 * `tenant_id`) and joining down would put the whole isolation guarantee in one
 * hand-written WHERE clause.
 *
 * A consequence worth stating: an Account with no `account_person` row is
 * invisible here, because it belongs to nobody. That state is deliberately
 * unrepresentable through the write routes (`assertDetachable`), so an empty
 * list means "no logins", never "logins we could not see".
 *
 * Response shape follows the generic list route exactly: a bare array without
 * `limit`, `{ rows, total }` with it. That is because `useEntityList` is
 * shared, and a second shape would be a second code path in the client for
 * one entity.
 */
const LIST_QUERY = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    q: z.string().trim().min(1).max(200).optional(),
});

/** Distinct tenants each account acts in, exactly, for a bounded set of ids. */
async function tenantCounts(tx: Tx, accountIds: string[]): Promise<Map<string, number>> {
    if (accountIds.length === 0) {
        return new Map();
    }

    /*
     * Through the SECURITY DEFINER function, not a join to `person`: inside this
     * transaction a join would see only THIS tenant's rows and every account
     * would report exactly one tenant, turning the shared-account badge into a
     * decoration that is always absent. The ids come from the RLS-scoped query
     * above, so the function is never asked about an account this tenant cannot
     * already see.
     */
    const rows = await tx.$queryRaw<{ account_id: string; tenants: number }[]>`
        SELECT a.id AS account_id, count(DISTINCT i.tenant_id)::int AS tenants
          FROM account a
          CROSS JOIN LATERAL calendry_internal.account_identities(a.id) i
         WHERE a.id = ANY(${accountIds}::text[])
         GROUP BY a.id
    `;

    return new Map(rows.map((row) => [row.account_id, row.tenants]));
}

export default defineEventHandler(async (event) => {
    const paging = await getValidatedQuery(event, LIST_QUERY.parse);

    return withRequestTenant(event, async (tx, identity) => {
        await requireAnyPermission(event, tx, crudPermission('accounts', 'read'));

        const where = {
            tenantId: identity.tenantId,
            accountLink: { isNot: null },
            ...(paging.q
                ? {
                    OR: [
                        { givenName: { contains: paging.q, mode: 'insensitive' as const } },
                        { familyName: { contains: paging.q, mode: 'insensitive' as const } },
                        { accountLink: { account: { email: { contains: paging.q, mode: 'insensitive' as const } } } },
                    ],
                }
                : {}),
        };

        const select = {
            id: true,
            givenName: true,
            familyName: true,
            isActive: true,
            accountLink: {
                select: {
                    account: {
                        select: {
                            id: true,
                            email: true,
                            isActive: true,
                            mustChangePassword: true,
                            lastLoginAt: true,
                            createdAt: true,
                        },
                    },
                },
            },
        };

        return mapDbErrors(async () => {
            // Sequential, because `tx` is one shared connection; concurrent
            // queries on it trip pg's deprecated overlapping-query warning.
            const people = await tx.person.findMany({
                where,
                select,
                orderBy: { familyName: 'asc' },
                ...(paging.limit === undefined
                    ? {}
                    : { take: paging.limit, skip: paging.offset ?? 0 }),
            });
            const total = paging.limit === undefined ? 0 : await tx.person.count({ where });

            const counts = await tenantCounts(
                tx,
                people.map((person) => person.accountLink!.account.id),
            );

            const rows = people.map((person) => {
                const account = person.accountLink!.account;
                const tenants = counts.get(account.id) ?? 1;

                return {
                    id: account.id,
                    email: account.email,
                    isActive: account.isActive,
                    mustChangePassword: account.mustChangePassword,
                    lastLoginAt: account.lastLoginAt,
                    createdAt: account.createdAt,
                    personId: person.id,
                    personName: `${person.givenName} ${person.familyName}`.trim(),
                    personActive: person.isActive,
                    /*
                     * A COUNT, never the names: which other institutions a
                     * colleague also works at is their business and not this
                     * tenant's. The number is here because it decides what this
                     * tenant may do with the login, so hiding it would leave the
                     * refusals on the detail page unexplained.
                     */
                    otherTenantCount: Math.max(0, tenants - 1),
                    isSoleTenant: tenants <= 1,
                };
            });

            return paging.limit === undefined ? rows : { rows, total };
        });
    });
});
