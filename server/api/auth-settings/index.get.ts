import { requirePermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

/**
 * This tenant's authorization defaults (issue #25): today, just which
 * AccessRole (if any) a newly created Person is granted automatically.
 *
 * Bespoke, mirroring `/api/display-settings`: a singleton, not a list, and
 * NOT part of `tenant_display_settings`: display and authorization are
 * different concerns that happen to both be tenant-wide, and the issue is
 * explicit that this does not belong in the display table.
 *
 * `tenant.read` only: unlike display settings, nothing else needs a wider
 * read here (no schedule rendering depends on this).
 */
export default defineEventHandler(async (event) => withRequestTenant(event, async (tx, identity) => {
    await requirePermission(event, tx, 'tenant.read');

    const row = await tx.tenantAuthSettings.findUnique({
        where: { tenantId: identity.tenantId },
        select: {
            defaultAccessRoleId: true,
            defaultAccessRole: { select: { id: true, name: true, key: true } },
        },
    });

    if (!row) {
        return { defaultAccessRoleId: null, defaultAccessRole: null, configured: false };
    }

    return {
        defaultAccessRoleId: row.defaultAccessRoleId,
        defaultAccessRole: row.defaultAccessRole,
        configured: true,
    };
}));
