import { z } from 'zod';
import { writeAuditLog } from '../../utils/auditLog';
import { requirePermission } from '../../utils/requirePermission';
import { buildTenantExportBundle, tenantExportToSheets } from '../../utils/tenantExport';
import { withRequestTenant } from '../../utils/tenantDb';
import { buildXlsxWorkbook } from '../../utils/xlsxExport';

const QUERY = z.object({ format: z.enum(['json', 'xlsx']).optional() });

defineRouteMeta({
    openAPI: {
        tags: ['Tenant'],
        summary: 'Export this institution\'s entire dataset',
        description: 'The tenant-wide half of issue #84 — Persons, logins, Groups, Rooms, Equipment, Roles, Offerings, Sessions, exam requests, Constraints and this tenant\'s audit trail, one sheet per entity. Self-service for a departing institution taking its data with it: gated on `tenant.export`, alongside `tenant.read`/`tenant.update` (this institution\'s own settings), never staff-only — erasing a tenant is the operation that stays staff-only (`DELETE /api/staff/tenants/:id`), not reading a copy of its own data.',
        parameters: [
            { name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'xlsx'] }, description: 'Defaults to json.' },
        ],
        responses: {
            200: { description: 'The export, as JSON or as an .xlsx attachment.' },
            403: { description: 'Missing tenant.export.' },
        },
    },
});

export default defineEventHandler(async (event) => withRequestTenant(event, async (tx, identity) => {
    await requirePermission(event, tx, 'tenant.export');

    const { format } = await getValidatedQuery(event, QUERY.parse);

    const bundle = await buildTenantExportBundle(tx, identity.tenantId);

    await writeAuditLog({
        action: 'tenant.exported',
        outcome: 'SUCCESS',
        actorPersonId: identity.actorPersonId,
        tenantId: identity.tenantId,
        detail: { via: 'api:tenant', personCount: bundle.persons.length },
    });

    if (format !== 'xlsx') {
        return bundle;
    }

    const buffer = await buildXlsxWorkbook(tenantExportToSheets(bundle));

    setResponseHeader(event, 'content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    setResponseHeader(event, 'content-disposition', 'attachment; filename="institution-data-export.xlsx"');

    return buffer;
}));
