import { z } from 'zod';
import { hashPassword } from '../../../utils/auth';
import {
    accountScope,
    assertSoleTenant,
    auditAccount,
    generatePassword,
    passwordSchema,
} from '../../../utils/accountAdmin';
import { mapDbErrors } from '../../../utils/dbErrors';
import { crudPermission } from '../../../utils/permissions';
import { requireAnyPermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';

/**
 * Issue a new password for a login, revoking every session it holds.
 *
 * AN EXPLICIT VERB, not a PATCH field, so the event log of the request itself
 * says what happened: the same rule Session's `move`/`swap`/`lock` follow. A
 * password arriving inside a general-purpose update body would make "somebody
 * edited an account" and "somebody took over an account" the same request.
 *
 * IDENTICAL EFFECT TO `bun run reset:password`: new hash, every session revoked
 * across every institution, `must_change_password` set. The one difference is
 * who may do it: the CLI answers to whoever holds the database credential, this
 * answers to `account.manage` inside one tenant, which is why it refuses a login
 * that tenant does not solely own.
 *
 * SETS `must_change_password` UNCONDITIONALLY. The administrator running this
 * necessarily learns the password, so it is a shared secret from the moment it
 * exists; the flag is what makes that temporary. There is deliberately no way to
 * turn it off here.
 */
const bodySchema = z.object({
    /** Omitted means generate one. A supplied one still has to clear the floor. */
    password: passwordSchema.optional(),
}).optional();

export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id') as string;
    const body = (await readValidatedBody(event, bodySchema.parse)) ?? {};

    return withRequestTenant(event, async (tx, identity) => {
        await requireAnyPermission(event, tx, crudPermission('accounts', 'update'));

        const scope = await accountScope(tx, identity.tenantId, id);

        assertSoleTenant(scope, 'resetting its password');

        const password = body.password ?? generatePassword();
        const passwordHash = await hashPassword(password);

        // One transaction, for the reason the CLI states: a reset that sets the
        // password but fails to revoke sessions is worse than one that does
        // neither, because the old session keeps working under a password its
        // holder no longer knows.
        const revoked = await mapDbErrors(async () => {
            await tx.account.update({
                where: { id: scope.id },
                data: { passwordHash, mustChangePassword: true },
            });

            const result = await tx.authSession.updateMany({
                where: { accountId: scope.id, revokedAt: null },
                data: { revokedAt: new Date() },
            });

            return result.count;
        });

        await auditAccount({
            action: 'account.password_reset',
            tenantId: identity.tenantId,
            accountId: scope.id,
            email: scope.email,
            actorPersonId: identity.actorPersonId ?? 'unknown',
            sessionsRevoked: revoked,
            supplied: Boolean(body.password),
        });

        // Shown once. Never stored in the clear, never re-readable.
        return { oneTimePassword: password, sessionsRevoked: revoked };
    });
});
