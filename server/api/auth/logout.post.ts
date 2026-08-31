import { SESSION_COOKIE } from '../../utils/auth';
import { resolveSessionToken, revokeSession } from '../../utils/authDb';

defineRouteMeta({
    openAPI: {
        tags: ['Auth'],
        summary: 'Log out',
        description: 'Revokes the current session server-side (a copied token stops working too) and clears the cookie. Idempotent: logging out without a session is a success, not an error.',
        responses: {
            204: { description: 'Session revoked (or there was none) and cookie cleared.' },
        },
    },
});

/**
 * End the current session.
 *
 * Revokes server-side rather than merely clearing the cookie, so a copied token
 * stops working too. Immediate revocation is the main reason sessions are
 * database-backed instead of JWTs.
 */
export default defineEventHandler(async (event) => {
    const token = getCookie(event, SESSION_COOKIE);

    if (token) {
        const session = await resolveSessionToken(token);

        if (session) {
            await revokeSession(session.session_id);
        }
    }

    deleteCookie(event, SESSION_COOKIE, { path: '/' });

    // Idempotent: logging out without a session is a success, not an error.
    setResponseStatus(event, 204);

    return null;
});
