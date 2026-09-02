import { SESSION_COOKIE } from '../../utils/auth';
import { listAccountIdentities, resolveSessionToken } from '../../utils/authDb';
import { resolveLocale } from '../../../shared/locale';
import { DEFAULT_TENANT_MODE } from '../../../shared/tenantMode';
import { loadPermissions } from '../../utils/requirePermission';
import { withTenant } from '../../utils/tenantDb';

defineRouteMeta({
    openAPI: {
        tags: ['Auth'],
        summary: 'Current session: who am I, where am I, what may I do',
        description: 'Returns the authenticated identity, the active tenant and the permission keys the active Person holds. The permission list is for driving UI visibility only; every route re-checks server-side. When no tenant is selected yet, tenantSelectionRequired is true and permissions is empty.',
        responses: {
            200: {
                description: 'The session state.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                accountId: { type: 'string' },
                                tenantSelectionRequired: { type: 'boolean' },
                                activeTenant: { type: 'object', nullable: true, properties: { id: { type: 'string' }, slug: { type: 'string' }, name: { type: 'string' } } },
                                activePersonId: { type: 'string' },
                                activePerson: { type: 'object', nullable: true, properties: { id: { type: 'string' }, givenName: { type: 'string' }, familyName: { type: 'string' } } },
                                permissions: { type: 'array', items: { type: 'string' } },
                                availableTenants: { type: 'array', items: { type: 'object', properties: { tenantId: { type: 'string' }, slug: { type: 'string' }, name: { type: 'string' }, personId: { type: 'string' }, isActive: { type: 'boolean' }, federationId: { type: 'string', nullable: true } } } },
                                locale: { type: 'string' },
                            },
                        },
                    },
                },
            },
            401: { description: 'No session cookie, or the session is expired or revoked.' },
        },
    },
});

/**
 * Who am I, where am I, and what may I do.
 *
 * The permission list is what a client should drive its UI from: hiding a
 * button the caller cannot use. It is emphatically not the enforcement point:
 * every route re-checks server-side, because a client is free to ignore this.
 */
export default defineEventHandler(async (event) => {
    const token = getCookie(event, SESSION_COOKIE);

    if (!token) {
        throw createError({ statusCode: 401, message: 'Not authenticated.' });
    }

    const session = await resolveSessionToken(token);

    if (!session) {
        throw createError({ statusCode: 401, message: 'Session expired or revoked.' });
    }

    const identities = await listAccountIdentities(session.account_id);

    const availableTenants = identities.map((i) => ({
        tenantId: i.tenant_id,
        slug: i.tenant_slug,
        name: i.tenant_name,
        personId: i.person_id,
        isActive: i.person_active,
        federationId: i.federation_id,
    }));

    const acceptLanguage = getHeader(event, 'accept-language');

    if (!session.person_id || !session.tenant_id) {
        return {
            accountId: session.account_id,
            tenantSelectionRequired: true,
            activeTenant: null,
            permissions: [],
            availableTenants,
            // No Person or Tenant resolved yet: the header is all there is.
            locale: resolveLocale({ acceptLanguage }),
            tenantMode: DEFAULT_TENANT_MODE,
        };
    }

    const { permissions, locale, tenantMode } = await withTenant(
        {
            kind: 'account',
            tenantId: session.tenant_id,
            federationId: session.federation_id,
            actorPersonId: session.person_id,
            accountId: session.account_id,
            sessionId: session.session_id,
        },
        async (tx) => {
            // Sequential: `tx` is one shared connection, and concurrent queries on
            // it trip pg's deprecated overlapping-query warning.
            const perms = await loadPermissions(tx, session.person_id as string);
            const person = await tx.person.findUnique({ where: { id: session.person_id as string }, select: { locale: true } });
            const display = await tx.tenantDisplaySettings.findUnique({
                where: { tenantId: session.tenant_id as string },
                select: { defaultLocale: true, mode: true },
            });

            return {
                permissions: perms,
                locale: resolveLocale({
                    personLocale: person?.locale,
                    tenantDefaultLocale: display?.defaultLocale,
                    acceptLanguage,
                }),
                // Issue #8. Absent row = default, same rule as everything
                // else read off this singleton.
                tenantMode: display?.mode ?? DEFAULT_TENANT_MODE,
            };
        },
    );

    const active = identities.find((i) => i.person_id === session.person_id);

    return {
        accountId: session.account_id,
        tenantSelectionRequired: false,
        activeTenant: active
            ? { id: active.tenant_id, slug: active.tenant_slug, name: active.tenant_name }
            : null,
        activePersonId: session.person_id,
        // Display name for the UI. Comes from the identity lookup that already
        // ran, so this costs no extra query.
        activePerson: active
            ? { id: active.person_id, givenName: active.given_name, familyName: active.family_name }
            : null,
        permissions: [...permissions].sort(),
        availableTenants,
        locale,
        tenantMode,
    };
});
