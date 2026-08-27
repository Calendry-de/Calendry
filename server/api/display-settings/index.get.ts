import { DISPLAY_DEFAULTS } from '../../../shared/sessionColor';
import { requirePermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

/**
 * How this tenant wants its schedule drawn.
 *
 * Gated on `session.read`, not a new permission. It carries no tenant data of
 * its own — only instructions for rendering data the caller can already see —
 * and minting a permission would leave every existing tenant 403ing on a
 * visible feature until someone remembered the `grant:permissions` backfill
 * step (CLAUDE.md).
 *
 * AN ABSENT ROW IS NOT AN ERROR. Provisioning does not seed one, so the common
 * case for a tenant that has never opened the page is no row at all — and that
 * must render identically to a tenant that opened it and changed nothing. The
 * defaults live in `shared/sessionColor.ts` with the resolution rule that reads
 * them, rather than being written into the database for every tenant on the
 * chance they might one day look.
 */
export default defineEventHandler(async (event) => withRequestTenant(event, async (tx, identity) => {
    await requirePermission(event, tx, 'session.read');

    const row = await tx.tenantDisplaySettings.findUnique({
        where: { tenantId: identity.tenantId },
    });

    if (!row) {
        return { ...DISPLAY_DEFAULTS, configured: false };
    }

    return {
        highlightOnline: row.highlightOnline,
        onlineColor: row.onlineColor,
        colorSourceOrder: row.colorSourceOrder,
        defaultColor: row.defaultColor,
        configured: true,
    };
}));
