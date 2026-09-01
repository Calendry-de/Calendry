import { STAFF_SESSION_COOKIE } from '../../utils/auth';
import { resolveStaffSessionToken, revokeStaffSession } from '../../utils/authDb';

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

/** End the current staff session — issue #76. Mirrors /api/auth/logout.post.ts. */
export default defineEventHandler(async (event) => {
    const token = getCookie(event, STAFF_SESSION_COOKIE);

    if (token) {
        const session = await resolveStaffSessionToken(token);

        if (session) {
            await revokeStaffSession(session.session_id);
        }
    }

    deleteCookie(event, STAFF_SESSION_COOKIE, { path: '/' });

    setResponseStatus(event, 204);

    return null;
});
