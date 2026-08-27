import { DISPLAY_DEFAULTS } from '../../../shared/sessionColor';
import { requireAnyPermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

/**
 * How this tenant wants its schedule drawn.
 *
 * `tenant.read` OR `session.read`, and the pair is the whole point.
 *
 * The PAGE is gated on `tenant.read` alone — viewing an institution's settings
 * is not something everyone who looks at a timetable should be offered, which is
 * what the navigation made obvious. But this endpoint has a second caller with a
 * completely different purpose: the schedule's own colour resolution, whose fetch
 * is TOLERANT by design (`scheduleData.ts` falls back to `DISPLAY_DEFAULTS`).
 * Narrowing this to `tenant.read` would therefore not deny anybody anything — it
 * would draw every lecturer's schedule in the wrong colours with nothing on
 * screen to say why, which is precisely the "no data and fetch failed render
 * identically" failure this codebase keeps writing rules about.
 *
 * So: `session.read` keeps reaching the RENDERING INSTRUCTIONS, and `tenant.read`
 * is what admits somebody to the settings. Same deliberate divergence
 * `access-roles` and `accounts` carry — the section's gate is narrower than the
 * endpoint's.
 *
 * AN ABSENT ROW IS NOT AN ERROR. Provisioning does not seed one, so the common
 * case for a tenant that has never opened the page is no row at all — and that
 * must render identically to a tenant that opened it and changed nothing. The
 * defaults live in `shared/sessionColor.ts` with the resolution rule that reads
 * them, rather than being written into the database for every tenant on the
 * chance they might one day look.
 */
export default defineEventHandler(async (event) => withRequestTenant(event, async (tx, identity) => {
    await requireAnyPermission(event, tx, ['tenant.read', 'session.read']);

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
