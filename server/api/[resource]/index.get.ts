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
 * unknown keys: adding `limit` to the query string of a resource whose filter
 * schema does not mention it would parse cleanly and then do nothing. Parsing
 * them from the raw query with their own schema makes an unsupported parameter
 * impossible rather than inert.
 */
const LIST_QUERY = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    q: z.string().trim().min(1).max(200).optional(),
    /**
     * Resolve exactly these rows, by id: the other half of search.
     *
     * A searchable picker never holds the full list, so it cannot label the
     * rows already assigned to the entity it is editing. It asks for those by
     * id instead, which is a fundamentally different question from a filter:
     * "these specific rows" rather than "rows matching this".
     *
     * REJECTS EMPTY rather than treating it as absent. `?ids=` is a caller that
     * meant to name rows and named none (most likely from `[].join(',')`), and
     * the two readings are "return nothing" and "return everything", one of
     * which is a silent tenant-wide dump. A 400 makes the mistake impossible to
     * ship instead of impossible to notice; a caller with nothing to resolve is
     * expected not to make the request at all.
     *
     * Capped at the same 200 as `limit`: this IS a page, addressed by identity
     * instead of by offset, and it travels in a URL.
     */
    ids: z.string()
        .transform((raw) => raw.split(',').map((value) => value.trim()).filter(Boolean))
        .pipe(z.array(z.string().min(1)).min(1).max(200))
        .optional(),
});

defineRouteMeta({
    openAPI: {
        tags: ['Resources'],
        summary: 'List rows of a core entity',
        description: 'Generic list route for the core entities (permission <resource>.read). THE RESPONSE SHAPE SWITCHES ON limit: without it the body is a bare array of rows; with it the body is { rows, total }. Each resource additionally accepts only the filters listed below whose description names it; an unsupported parameter is a 400, never silently ignored. Two of them are not equality: rooms/minCapacity is a lower bound, and groups/termId returns the groups scoped to that term AND every group carrying no scope at all. Federation-ownable resources (rooms, equipment, offerings) also surface rows shared into the federation.',
        parameters: [
            { name: 'resource', in: 'path', required: true, schema: { type: 'string', enum: ['persons', 'roles', 'groups', 'rooms', 'equipment', 'offerings', 'offering-templates', 'offering-plans', 'time-grids', 'terms', 'constraints', 'session-kinds', 'calendar-periods', 'access-roles'] } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200 }, description: 'Presence switches the response shape to { rows, total }.' },
            { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 } },
            { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Case-insensitive text search over the resource declared search fields. 400 on a resource without any.' },
            { name: 'ids', in: 'query', schema: { type: 'string' }, description: 'Comma-separated ids to resolve exactly these rows (max 200). An empty value is a 400, never a full dump.' },

            // Per-resource equality filters. Each one is accepted ONLY by the
            // resources named in its description: sending it to any other
            // resource is a 400, not a silently ignored parameter.
            { name: 'isActive', in: 'query', schema: { type: 'boolean' }, description: 'persons, rooms, offerings.' },
            { name: 'email', in: 'query', schema: { type: 'string' }, description: 'persons.' },
            { name: 'key', in: 'query', schema: { type: 'string' }, description: 'roles, equipment, session-kinds, access-roles.' },
            { name: 'parentGroupId', in: 'query', schema: { type: 'string' }, description: 'groups.' },
            { name: 'termId', in: 'query', schema: { type: 'string' }, description: 'groups (SCOPED-OR-UNIVERSAL: returns the groups scoped to this term AND every group carrying no scope at all, because no group_term row means every term), offerings and calendar-periods (equality).' },
            { name: 'isVirtual', in: 'query', schema: { type: 'boolean' }, description: 'rooms.' },
            { name: 'minCapacity', in: 'query', schema: { type: 'integer' }, description: 'rooms; capacity >= this value, not equality.' },
            { name: 'excludeId', in: 'query', schema: { type: 'string' }, description: 'rooms; every room but this one. The footprint picker sends the room being edited.' },
            { name: 'kindId', in: 'query', schema: { type: 'string' }, description: 'offerings, offering-templates.' },
            { name: 'isDefault', in: 'query', schema: { type: 'boolean' }, description: 'time-grids.' },
            { name: 'kind', in: 'query', schema: { type: 'string', enum: ['HOLIDAY', 'BREAK', 'EXAM'] }, description: 'calendar-periods.' },
            { name: 'type', in: 'query', schema: { type: 'string' }, description: 'constraints; a key from the constraint-type catalogue.' },
            { name: 'severity', in: 'query', schema: { type: 'string', enum: ['HARD', 'SOFT'] }, description: 'constraints.' },
            { name: 'isEnabled', in: 'query', schema: { type: 'boolean' }, description: 'constraints.' },
        ],
        responses: {
            200: { description: 'Without limit: a bare array of rows. With limit: { rows: [...], total: number }.' },
            400: { description: 'Malformed or unsupported query parameter, empty ids, or q on a non-searchable resource.' },
        },
    },
});

/**
 * List rows of a core entity within the caller's tenant.
 *
 * RESPONSE SHAPE IS CONDITIONAL, deliberately:
 *
 *   no `limit`  →  a bare array, exactly as before
 *   `limit`     →  { rows, total }
 *
 * A paginated caller is asking a different question: "give me a page, and tell
 * me how many there are", and needs the count to say so. Making the shape
 * switch on `limit` keeps every existing caller (the schedule view's five
 * reference fetches, the integration tests) byte-identical, instead of
 * rewriting them for a feature they do not use.
 */
export default defineEventHandler(async (event) => {
    const resource = getRouterParam(event, 'resource');
    const config = getResource(resource);
    // Both go through getValidatedQuery so a malformed parameter is a 400 with
    // the offending field named. Calling `LIST_QUERY.parse` directly throws a
    // bare ZodError, which h3 reports as a 500: an input mistake dressed up as
    // a server fault.
    const paging = await getValidatedQuery(event, LIST_QUERY.parse);
    const query = await getValidatedQuery(event, config.filters.parse);

    return withRequestTenant(event, async (tx, identity) => {
        await requireAnyPermission(event, tx, crudPermission(resource as string, 'read'));


        /**
         * Filters that are not plain column equality (a range, or a relation)
         * are declared per resource and become AND clauses instead.
         *
         * Per resource, not per filter name: `minCapacity` used to be
         * special-cased by name here, which happens to be safe only because one
         * resource declares it. `termId` is not safe that way: `offerings`
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
        // search clause below cannot overwrite it: two sibling `OR` keys on one
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

        // AND-ed with everything else, ownership included, so naming an id
        // cannot reach a row outside the tenant (or its federation): the id is
        // a narrowing, never an escape hatch.
        if (paging.ids !== undefined) {
            conditions.push({ id: { in: paging.ids } });
        }

        if (paging.q) {
            const fields = config.searchFields ?? [];

            // A resource with no declared search fields cannot be searched. It
            // must not silently ignore `q` and return everything: that reads as
            // "no results were filtered out" when it means "search is not
            // implemented here".
            if (fields.length === 0) {
                throw createError({
                    statusCode: 400,
                    message: `Resource '${resource}' does not support text search.`,
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

            // Sequential, because `tx` is one shared connection; concurrent queries on
            // it trip pg's deprecated overlapping-query warning.
            const rows = await delegate(tx, config.model).findMany({
                include: config.include,
                where,
                orderBy: config.orderBy,
                take: paging.limit,
                skip: paging.offset ?? 0,
            });
            const total = await delegate(tx, config.model).count({ where });

            return { rows, total };
        });
    });
});
