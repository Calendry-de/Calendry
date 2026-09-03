import { z } from 'zod';
import { requireStaffIdentity } from '../../../utils/tenantDb';
import { getOwnerPrisma } from '../../../utils/ownerPrisma';

/**
 * The persisted audit log (issue #78), READABLE at last, by Calendry staff.
 *
 * `audit_log` is the fifth tenant-isolation exception: no `tenant_id` FK, no
 * RLS, because a denied cross-tenant attempt names the tenant that was DENIED
 * and a bare login failure predates any tenant. That is exactly why the first
 * reader is the staff principal and not a tenant route: a staff session is
 * never IN a tenant, so it is the one caller for whom "every row, whichever
 * tenant" is the honest answer rather than a leak. Read through the OWNER
 * connection like `GET /api/staff/tenants`, a plain cross-tenant read.
 *
 * Tenant ids on the rows are PLAIN ids by design (a tenant may be erased after
 * the events it caused); they are labelled here by a lookup, and a row whose
 * tenant no longer exists keeps its id and gets no label rather than being
 * dropped, since "an erased tenant did this" is precisely the kind of fact an
 * audit log exists to keep.
 */
const QUERY = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    action: z.string().min(1).max(100).optional(),
    outcome: z.enum(['SUCCESS', 'FAILURE', 'DENIED']).optional(),
    tenantId: z.string().min(1).optional(),
    /** Case-insensitive substring over the actor label and the target. */
    q: z.string().trim().min(1).max(200).optional(),
});

defineRouteMeta({
    openAPI: {
        tags: ['Staff'],
        summary: 'Calendry staff: read the audit log across every tenant',
        description: 'Newest first, paged. Requires a staff session (StaffIdentity): never reachable by a tenant Account or API token, and never routed through withRequestTenant/RLS; audit_log carries no RLS by design (the fifth tenant-isolation exception), so the staff principal, which is never in a tenant, is its first and only reader. Reads through the OWNER connection like GET /api/staff/tenants.',
        parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
            { name: 'action', in: 'query', schema: { type: 'string' }, description: 'Exact event key, e.g. login.failure. The response lists every key seen in `actions`.' },
            { name: 'outcome', in: 'query', schema: { type: 'string', enum: ['SUCCESS', 'FAILURE', 'DENIED'] } },
            { name: 'tenantId', in: 'query', schema: { type: 'string' }, description: 'Rows about this tenant, including denied attempts AGAINST it.' },
            { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Case-insensitive substring over actorLabel and target.' },
        ],
        responses: {
            200: {
                description: 'A page of audit rows, the total matching the filters, and every action key ever written.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                rows: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            id: { type: 'string' },
                                            action: { type: 'string' },
                                            outcome: { type: 'string', enum: ['SUCCESS', 'FAILURE', 'DENIED'] },
                                            actorPersonId: { type: 'string', nullable: true },
                                            actorAccountId: { type: 'string', nullable: true },
                                            actorLabel: { type: 'string', nullable: true },
                                            target: { type: 'string', nullable: true },
                                            tenantId: { type: 'string', nullable: true },
                                            tenant: {
                                                type: 'object',
                                                nullable: true,
                                                description: 'Null when the row names no tenant OR the tenant has since been erased; the id above is kept either way.',
                                                properties: { slug: { type: 'string' }, name: { type: 'string' } },
                                            },
                                            detail: { type: 'object' },
                                            createdAt: { type: 'string', format: 'date-time' },
                                        },
                                    },
                                },
                                total: { type: 'integer' },
                                actions: { type: 'array', items: { type: 'string' }, description: 'Distinct action keys across the whole log, for the filter control.' },
                            },
                        },
                    },
                },
            },
            403: { description: 'No staff session (a tenant Account/token session is refused just as hard as no session at all).' },
        },
    },
});

export default defineEventHandler(async (event) => {
    requireStaffIdentity(event);

    const query = await getValidatedQuery(event, QUERY.parse);
    const prisma = getOwnerPrisma();

    const where = {
        ...(query.action ? { action: query.action } : {}),
        ...(query.outcome ? { outcome: query.outcome } : {}),
        ...(query.tenantId ? { tenantId: query.tenantId } : {}),
        ...(query.q
            ? {
                OR: [
                    { actorLabel: { contains: query.q, mode: 'insensitive' as const } },
                    { target: { contains: query.q, mode: 'insensitive' as const } },
                ],
            }
            : {}),
    };

    // Sequential on purpose: one connection, and pg warns on overlapping
    // queries, the same reason the schedule routes read one after another.
    const total = await prisma.auditLog.count({ where });
    const rows = await prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit,
        skip: query.offset,
    });
    const actionRows = await prisma.auditLog.groupBy({ by: ['action'], orderBy: { action: 'asc' } });

    const tenantIds = [...new Set(rows.map((row) => row.tenantId).filter((id): id is string => id !== null))];
    const tenants = tenantIds.length
        ? await prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, slug: true, name: true } })
        : [];
    const tenantById = new Map(tenants.map((tenant) => [tenant.id, { slug: tenant.slug, name: tenant.name }]));

    return {
        rows: rows.map((row) => ({
            id: row.id,
            action: row.action,
            outcome: row.outcome,
            actorPersonId: row.actorPersonId,
            actorAccountId: row.actorAccountId,
            actorLabel: row.actorLabel,
            target: row.target,
            tenantId: row.tenantId,
            tenant: row.tenantId ? (tenantById.get(row.tenantId) ?? null) : null,
            detail: row.detail,
            createdAt: row.createdAt,
        })),
        total,
        actions: actionRows.map((row) => row.action),
    };
});
