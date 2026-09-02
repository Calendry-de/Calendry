import { z } from 'zod';
import { hashPassword, verifyPassword } from '../../utils/auth';
import {
    checkRateLimit, findStaffAccountByEmail, resetRateLimit, updateStaffPasswordAndRevokeSessions,
} from '../../utils/authDb';

const bodySchema = z.object({
    email: z.string().email(),
    currentPassword: z.string().min(1),
    newPassword: z.string().min(12, 'New password must be at least 12 characters.'),
});

defineRouteMeta({
    openAPI: {
        tags: ['Staff auth'],
        summary: 'Change a StaffAccount password',
        description: 'Public by necessity, mirroring /api/auth/change-password: this is the only way out of a forced or expired staff password, which deliberately issues no session. Re-authenticates from the credentials in the body rather than trusting a cookie. On success every open staff session of the account is revoked and there is no auto-login; sign in again with the new password. Rate-limited separately from staff login.',
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['email', 'currentPassword', 'newPassword'],
                        properties: {
                            email: { type: 'string', format: 'email' },
                            currentPassword: { type: 'string' },
                            newPassword: { type: 'string', description: 'At least 12 characters.' },
                        },
                    },
                },
            },
        },
        responses: {
            204: { description: 'Password changed and every open staff session revoked.' },
            401: { description: 'Invalid credentials. Deliberately identical for unknown email and wrong password.' },
            422: { description: 'The new password equals the current one.' },
        },
    },
});

/**
 * Change a StaffAccount's password (issue #106), mirroring
 * `/api/auth/change-password.post.ts` exactly for the staff plane.
 *
 * PUBLIC BY NECESSITY (`tenant-context.ts`'s `PUBLIC_API_PATHS`): a forced
 * reset issues no staff session, so requiring one here would make the flag
 * unclearable. Re-authenticates from the credentials in the body instead of
 * trusting a cookie.
 */
export default defineEventHandler(async (event) => {
    const body = await readValidatedBody(event, bodySchema.parse);

    // Counted SEPARATELY from `staff_login` (same reasoning as the tenant
    // route's own comment): this route accepts the same secret as a second
    // door.
    await checkRateLimit('staff_change_password', body.email, { maxAttempts: 10, windowMinutes: 15 });

    const account = await findStaffAccountByEmail(body.email);

    // Same generic 401 and same work as staff login, so this endpoint does
    // not become the staff-account-existence oracle that login avoids being.
    const ok = account
        ? await verifyPassword(body.currentPassword, account.passwordHash)
        : await verifyPassword(body.currentPassword, 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');

    if (!account || !account.isActive || !ok) {
        throw createError({ statusCode: 401, message: 'Invalid credentials.' });
    }

    await resetRateLimit('staff_change_password', body.email);

    if (await verifyPassword(body.newPassword, account.passwordHash)) {
        throw createError({
            statusCode: 422,
            message: 'The new password must be different from the current one.',
        });
    }

    await updateStaffPasswordAndRevokeSessions(account.id, await hashPassword(body.newPassword));

    // No auto-login. The caller signs in normally with the new password.
    setResponseStatus(event, 204);

    return null;
});
