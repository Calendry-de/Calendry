import { z } from 'zod';
import { writeAuditLog } from '../../utils/auditLog';
import { buildPersonExportBundle, personExportToSheets } from '../../utils/personExport';
import { requirePermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';
import { buildXlsxWorkbook } from '../../utils/xlsxExport';

const QUERY = z.object({ format: z.enum(['json', 'xlsx']).optional() });

defineRouteMeta({
    openAPI: {
        tags: ['Persons'],
        summary: 'Export a Person\'s full data (GDPR access request on someone else\'s record)',
        description: 'Same bundle `GET /api/me/export` returns for a caller\'s own record, for a Person named by id instead: the administrator half of issue #84. Gated on `person.export`, a permission separate from `person.read`: this reaches sessions, memberships, preferences, exam requests, tokens and the audit trail, well past what "may see this person in a list" implies. `?format=xlsx` returns a workbook with one sheet per category. A SIBLING resource of `persons`, deliberately not nested under it (`/api/persons/:id/export`), because `persons` is a live `CRUD_RESOURCES` key served by the generic `/api/[resource]` route, and a literal `server/api/persons/` directory shadows that dynamic route for the WHOLE `/api/persons/*` subtree in Nitro\'s file-based router, not just the one path defined under it. Verified the hard way: it 404\'d every other /api/persons/* request until this route moved here.',
        parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'xlsx'] }, description: 'Defaults to json.' },
        ],
        responses: {
            200: { description: 'The export, as JSON or as an .xlsx attachment.' },
            403: { description: 'Missing person.export.' },
            404: { description: 'No such Person in this institution.' },
        },
    },
});

export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id') as string;

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'person.export');

        const { format } = await getValidatedQuery(event, QUERY.parse);

        const bundle = await buildPersonExportBundle(tx, identity.tenantId, id);

        await writeAuditLog({
            action: 'person.exported',
            outcome: 'SUCCESS',
            actorPersonId: identity.actorPersonId,
            tenantId: identity.tenantId,
            target: bundle.person.email ?? bundle.person.id,
            detail: { via: 'api:person-export', self: false, subjectPersonId: bundle.person.id },
        });

        if (format !== 'xlsx') {
            return bundle;
        }

        const buffer = await buildXlsxWorkbook(personExportToSheets(bundle));

        setResponseHeader(event, 'content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        setResponseHeader(event, 'content-disposition', `attachment; filename="person-${bundle.person.id}-export.xlsx"`);

        return buffer;
    });
});
