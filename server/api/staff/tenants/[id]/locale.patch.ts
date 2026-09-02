import { z } from 'zod';
import { isUsableLocale } from '../../../../../shared/locale';
import { requireStaffIdentity } from '../../../../utils/tenantDb';
import { getPrisma } from '../../../../utils/prisma';
import { UnknownTenantIdError } from '../../../../utils/staffCreateTenant';
import { setTenantLocaleViaFunction } from '../../../../utils/staffTenantLocale';

const bodySchema = z.object({
    /**
     * `null` CLEARS the tenant default (defer to `Accept-Language`); the key
     * must be PRESENT to change anything, so omitting it is refused rather
     * than silently treated as a clear. Exactly the precedent
     * `[id].patch.ts`'s `federationId` sets, for the same "guards must fail
     * loudly" reason CLAUDE.md names.
     *
     * VALIDATED HERE, at the write boundary, the same way
     * `PUT /api/display-settings` and `PUT /api/me/settings` validate this
     * column and `Person.locale`: an unusable tag would be silently skipped
     * by `resolveLocale()` at READ time, which is a setting that saves,
     * displays, and does nothing. The SQL function cannot do this check —
     * `isUsableLocale()` round-trips through `Intl.DateTimeFormat` and
     * PL/pgSQL has no equivalent.
     */
    defaultLocale: z.string().nullable()
        .refine((value) => value == null || isUsableLocale(value), 'Not a recognised locale.'),
});

defineRouteMeta({
    openAPI: {
        tags: ['Staff'],
        summary: 'Calendry staff: set or clear a Tenant\'s default locale',
        description: 'Writes TenantDisplaySettings.defaultLocale for one tenant from the staff panel. That BCP-47 tag decides BOTH the institution\'s default date/number format (issue #17) and its interface language (issue #19, via resolveLanguage()) for every Person who has not set their own. Calls calendry_internal.staff_set_tenant_locale() (SECURITY DEFINER, the same technique as tenant creation, federation attach/detach and erasure) through the ordinary runtime connection, never the owner connection: tenant_display_settings carries RLS and a staff session is never in a tenant. Upserts the settings singleton, since an absent row means defaults. defaultLocale: null clears the default (deferring to Accept-Language) and inserts nothing when no row existed. A SIBLING of PATCH /api/staff/tenants/{id} rather than a second key on it, so each route keeps exactly one required body key: on that route an absent key is refused rather than read as "clear", and adding an optional second key would have replaced that guard with a weaker "at least one of".',
        parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'The Tenant id (not slug).' },
        ],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['defaultLocale'],
                        properties: {
                            defaultLocale: { type: 'string', nullable: true, description: 'A BCP-47 tag (e.g. de-DE), or null to clear the tenant default.' },
                        },
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'Updated. Echoes the stored value read back out of the table.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                tenantId: { type: 'string' },
                                tenantSlug: { type: 'string' },
                                defaultLocale: { type: 'string', nullable: true },
                                configured: { type: 'boolean', description: 'Whether a TenantDisplaySettings row exists now. False only when a clear found no row to clear.' },
                            },
                        },
                    },
                },
            },
            400: { description: 'defaultLocale absent, or not a recognised BCP-47 tag.' },
            403: { description: 'No staff session (a tenant Account/token session is refused just as hard as no session at all).' },
            404: { description: 'No such Tenant.' },
        },
    },
});

/**
 * Sets one tenant's default locale, staff-side.
 *
 * WHY STAFF MAY DO THIS AT ALL, when a tenant admin already can through
 * `PUT /api/display-settings`: an institution being onboarded has no admin
 * signed in yet, and this value decides which language that admin's very
 * first login renders in. Same reasoning as tenant creation and federation
 * attach/detach already living here.
 *
 * `requireStaffIdentity` throws before this handler touches the database if
 * the caller is not `kind === 'staff'`, so a tenant-scoped Account or API
 * token gets the identical 403 a request with no session at all would.
 */
export default defineEventHandler(async (event) => {
    requireStaffIdentity(event);

    const tenantId = getRouterParam(event, 'id') as string;
    const body = await readValidatedBody(event, bodySchema.parse);

    try {
        return await setTenantLocaleViaFunction(getPrisma(), { tenantId, locale: body.defaultLocale });
    } catch (error) {
        if (error instanceof UnknownTenantIdError) {
            throw createError({ statusCode: 404, message: 'Tenant not found.', data: { field: 'id' } });
        }

        throw error;
    }
});
