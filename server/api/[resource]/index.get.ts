import { z } from 'zod';
import { mapDbErrors } from '../../utils/dbErrors';
import { delegate, getResource } from '../../utils/resources';
import { crudPermission } from '../../utils/permissions';
import { requireAnyPermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

/**
 * Paging and free-text search, kept separate from each resource's own filters.
 *
 * These cannot live in `config.filters` because a zod object silently STRIPS
 * unknown keys — adding `limit` to the query string of a resource whose filter
 * schema does not mention it would parse cleanly and then do nothing. Parsing
 * them from the raw query with their own schema makes an unsupported parameter
 * impossible rather than inert.
 */
const LIST_QUERY = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    q: z.string().trim().min(1).max(200).optional(),
});

/**
 * List rows of a core entity within the caller's tenant.
 *
 * RESPONSE SHAPE IS CONDITIONAL, deliberately:
 *
 *   no `limit`  →  a bare array, exactly as before
 *   `limit`     →  { rows, total }
 *
 * A paginated caller is asking a different question — "give me a page, and tell
 * me how many there are" — and needs the count to say so. Making the shape
 * switch on `limit` keeps every existing caller (the schedule view's five
 * reference fetches, the integration tests) byte-identical, instead of
 * rewriting them for a feature they do not use.
 */
export default defineEventHandler(async (event) => {
    const resource = getRouterParam(event, 'resource');
    const config = getResource(resource);
    // Both go through getValidatedQuery so a malformed parameter is a 400 with
    // the offending field named. Calling `LIST_QUERY.parse` directly throws a
    // bare ZodError, which h3 reports as a 500 — an input mistake dressed up as
    // a server fault.
    const paging = await getValidatedQuery(event, LIST_QUERY.parse);
    const query = await getValidatedQuery(event, config.filters.parse);

    return withRequestTenant(event, async (tx, identity) => {
        await requireAnyPermission(event, tx, crudPermission(resource as string, 'read'));


        /**
         * Filters that are not plain column equality — a range, or a relation —
         * are declared per resource and become AND clauses instead.
         *
         * Per resource, not per filter name: `minCapacity` used to be
         * special-cased by name here, which happens to be safe only because one
         * resource declares it. `termId` is not safe that way — `offerings`
         * declares a `termId` filter that IS a column, so a name-keyed rule
         * would rewrite it into a relation query against a relation Offering
         * does not have.
         */
        const builders = config.relationalFilters ?? {};
        const relational: Record<string, unknown>[] = [];
        const where: Record<string, unknown> = {};

        // Partitioned rather than spread-then-delete: `no-dynamic-delete` bans
        // the latter, and one pass is clearer than building a copy to unbuild.
        for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
            const build = builders[key];

            if (build && value !== undefined) {
                relational.push((build as (v: unknown) => Record<string, unknown>)(value));
            } else {
                where[key] = value;
            }
        }

        // Explicit tenant filter in addition to RLS. RLS makes a mistake here
        // harmless, but defence in depth means not relying on that alone.
        // Federation-ownable entities must also surface shared rows, otherwise a
        // consortium's shared lecture hall would be invisible to its members.
        //
        // Ownership goes under AND rather than a bare OR so that adding the
        // search clause below cannot overwrite it — two sibling `OR` keys on one
        // object would leave only the last, quietly widening the query past the
        // tenant boundary.
        const ownership = config.federationOwnable
            ? {
                OR: [
                    { tenantId: identity.tenantId },
                    ...(identity.federationId ? [{ federationId: identity.federationId }] : []),
                ],
            }
            : { tenantId: identity.tenantId };

        const conditions: Record<string, unknown>[] = [ownership, ...relational];

        if (paging.q) {
            const fields = config.searchFields ?? [];

            // A resource with no declared search fields cannot be searched. It
            // must not silently ignore `q` and return everything — that reads as
            // "no results were filtered out" when it means "search is not
            // implemented here".
            if (fields.length === 0) {
                throw createError({
                    statusCode: 400,
                    statusMessage: `Resource '${resource}' does not support text search.`,
                });
            }

            conditions.push({
                OR: fields.map((field) => ({ [field]: { contains: paging.q, mode: 'insensitive' } })),
            });
        }

        Object.assign(where, { AND: conditions });

        return mapDbErrors(async () => {
            if (paging.limit === undefined) {
                return delegate(tx, config.model).findMany({ where, orderBy: config.orderBy, include: config.include });
            }

            const [rows, total] = await Promise.all([
                delegate(tx, config.model).findMany({
                    include: config.include,
                    where,
                    orderBy: config.orderBy,
                    take: paging.limit,
                    skip: paging.offset ?? 0,
                }),
                delegate(tx, config.model).count({ where }),
            ]);

            return { rows, total };
        });
    });
});
