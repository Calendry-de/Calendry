import { z } from 'zod';
import { mapDbErrors } from '../../utils/dbErrors';
import { requirePermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

/**
 * Set (or clear) this tenant's default AccessRole for new People (issue #25).
 *
 * GATED ON BOTH `tenant.update` AND `person_access_role.assign`: this is
 * the same authority as granting a role by hand, wearing a default's
 * clothes, so it needs both the permission that lets somebody change tenant
 * configuration and the permission that lets them grant access at all. A
 * role holding only one of the two is refused, the way `display-settings`'
 * own note warns a mismatched pairing eventually gets noticed as a bug.
 *
 * UPSERT: the row is a singleton keyed by `tenant_id`, absence means "no
 * default", same convention `tenant_display_settings` uses.
 */
const schema = z.object({
    /** `null` clears the default: explicit, not `undefined`, so a caller
     *  cannot "clear" by simply omitting the field. */
    defaultAccessRoleId: z.string().min(1).nullable(),
});

export default defineEventHandler(async (event) => {
    const input = await readValidatedBody(event, schema.parse);

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'tenant.update');
        await requirePermission(event, tx, 'person_access_role.assign');

        if (input.defaultAccessRoleId) {
            const role = await tx.accessRole.findFirst({
                where: { id: input.defaultAccessRoleId, tenantId: identity.tenantId },
                select: { id: true },
            });

            if (!role) {
                throw createError({ statusCode: 422, message: 'No such access role.' });
            }
        }

        return mapDbErrors(async () => {
            const row = await tx.tenantAuthSettings.upsert({
                where: { tenantId: identity.tenantId },
                create: { tenantId: identity.tenantId, defaultAccessRoleId: input.defaultAccessRoleId },
                update: { defaultAccessRoleId: input.defaultAccessRoleId },
                select: {
                    defaultAccessRoleId: true,
                    defaultAccessRole: { select: { id: true, name: true, key: true } },
                },
            });

            return {
                defaultAccessRoleId: row.defaultAccessRoleId,
                defaultAccessRole: row.defaultAccessRole,
                configured: true,
            };
        });
    });
});
