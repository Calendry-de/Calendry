import { z } from 'zod';
import { writeAuditLog } from '../../utils/auditLog';
import { buildPersonExportBundle, personExportToSheets } from '../../utils/personExport';
import { withRequestTenant } from '../../utils/tenantDb';
import { buildXlsxWorkbook } from '../../utils/xlsxExport';

const QUERY = z.object({ format: z.enum(['json', 'xlsx']).optional() });

defineRouteMeta({
    openAPI: {
        tags: ['My account'],
        summary: 'Export everything Calendry holds about me (GDPR Right to Access)',
        description: 'Self-service, no permission beyond being signed in — the caller\'s own Person, Account, roles, memberships, sessions, unavailability, preferences, exam requests, API tokens, calendar links (metadata only, no live secrets) and own audit trail. `?format=xlsx` returns a workbook with one sheet per category; anything else returns the same data as JSON.',
        parameters: [
            { name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'xlsx'] }, description: 'Defaults to json.' },
        ],
        responses: {
            200: { description: 'The export, as JSON or as an .xlsx attachment.' },
            403: { description: 'No acting Person on this request (a screen or the poller).' },
        },
    },
});

/**
 * `GET /api/me/export` (issue #84) — the self-service half of per-Person
 * export. Mirrors every other `/api/me/*` route: no permission key, because
 * the WHERE is the caller's own Person, and the export can never reach
 * anyone else's data no matter what the caller otherwise holds.
 */
export default defineEventHandler(async (event) => withRequestTenant(event, async (tx, identity) => {
    if (!identity.actorPersonId) {
        throw createError({ statusCode: 403, statusMessage: 'No acting person on this request.' });
    }

    const { format } = await getValidatedQuery(event, QUERY.parse);

    const bundle = await buildPersonExportBundle(tx, identity.tenantId, identity.actorPersonId);

    await writeAuditLog({
        action: 'person.exported',
        outcome: 'SUCCESS',
        actorPersonId: identity.actorPersonId,
        tenantId: identity.tenantId,
        target: bundle.person.email ?? bundle.person.id,
        detail: { via: 'api:me', self: true },
    });

    if (format !== 'xlsx') {
        return bundle;
    }

    const buffer = await buildXlsxWorkbook(personExportToSheets(bundle));

    setResponseHeader(event, 'content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    setResponseHeader(event, 'content-disposition', 'attachment; filename="my-data-export.xlsx"');

    return buffer;
}));
