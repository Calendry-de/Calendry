import { STAFF_SESSION_COOKIE } from '../../utils/auth';
import { resolveStaffSessionToken, revokeStaffSession } from '../../utils/authDb';
import { writeAuditLog } from '../../utils/auditLog';

defineRouteMeta({
    openAPI: {
        tags: ['Staff auth'],
        summary: 'Calendry staff: log out',
        description: 'Revokes the current staff session server-side and clears the staff cookie. Idempotent: logging out without a staff session is a success, not an error. Mirrors /api/auth/logout for the tenant plane.',
        responses: {
            204: { description: 'Staff session revoked (or there was none) and cookie cleared.' },
        },
    },
});

/**
 * End the current staff session (issue #76). Mirrors /api/auth/logout.post.ts.
 *
 * Audited (issue #106) only when there was an actual session to revoke: an
 * idempotent logout with no cookie/session names no actor and would be a
 * meaningless row.
 */
export default defineEventHandler(async (event) => {
    const token = getCookie(event, STAFF_SESSION_COOKIE);

    if (token) {
        const session = await resolveStaffSessionToken(token);

        if (session) {
            await revokeStaffSession(session.session_id);

            await writeAuditLog({
                action: 'staff_logout',
                outcome: 'SUCCESS',
                actorAccountId: session.staff_account_id,
                actorLabel: session.email,
                tenantId: null,
            });
        }
    }

    deleteCookie(event, STAFF_SESSION_COOKIE, { path: '/' });

    setResponseStatus(event, 204);

    return null;
});
