import { z } from 'zod';
import { hashPassword } from '../../utils/auth';
import {
    accountScope,
    accountView,
    auditAccount,
    createAccountRow,
    generatePassword,
    linkAccountToPerson,
    passwordSchema,
    resolveAttachablePerson,
} from '../../utils/accountAdmin';
import { mapDbErrors } from '../../utils/dbErrors';
import { crudPermission } from '../../utils/permissions';
import { requireAnyPermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

/**
 * Issue a login for a Person in this institution.
 *
 * A PERSON IS REQUIRED, and that is the load-bearing choice here. An Account
 * with no `account_person` row is invisible to every tenant — not listable, not
 * resettable, not deletable — while its password still works. Making the link
 * part of creation, rather than a later step, means that state never exists
 * rather than being cleaned up afterwards. The mirror rule lives in
 * `assertDetachable`.
 *
 * AN EXISTING EMAIL IS AN OFFER, NOT A WALL. `account.email` is globally unique
 * and one Account is meant to act in several institutions, so "someone already
 * has this address" is the ordinary case for a lecturer arriving from a partner
 * university — not an error. Answering it with a bare 409 was the actual
 * complaint that produced this endpoint: the admin was told the address was
 * taken and had no way forward. So the first attempt reports it with
 * `accountExists: true`, and a second carrying `attachExisting: true` links that
 * credential to this person instead of minting a second one.
 *
 * WHY NOT JUST ATTACH SILENTLY: attaching is a different act with different
 * consequences — the person will sign in with a password this institution did
 * not set and cannot see, and the account becomes shared, which permanently
 * removes this tenant's ability to reset it (see `assertSoleTenant`). That is
 * not something to do on the strength of a typo in an email field.
 */
const bodySchema = z.object({
    email: z.string().email().transform((value) => value.toLowerCase()),
    personId: z.string().min(1),
    /**
     * Omitted means "generate one and show it once". Deliberately not defaulted
     * to a fixed string anywhere.
     */
    password: passwordSchema.optional(),
    /**
     * Whether the person must choose their own password at first sign-in.
     * Defaults TRUE: a password an administrator knows is a shared secret, and
     * the whole point of `must_change_password` is that it stops being one.
     */
    mustChangePassword: z.boolean().optional(),
    /**
     * Accepted at creation, not only on the later PATCH, so a login can be
     * prepared before the person starts. The management form renders the toggle
     * on both pages and zod would STRIP an undeclared key — a switch that saves
     * nothing and reports success.
     */
    isActive: z.boolean().optional(),
    /** Explicit consent to reuse the credential that already holds this email. */
    attachExisting: z.boolean().optional(),
});

export default defineEventHandler(async (event) => {
    const body = await readValidatedBody(event, bodySchema.parse);

    return withRequestTenant(event, async (tx, identity) => {
        await requireAnyPermission(event, tx, crudPermission('accounts', 'create'));

        const person = await resolveAttachablePerson(tx, identity.tenantId, body.personId);

        const existing = await tx.account.findUnique({
            where: { email: body.email },
            select: { id: true },
        });

        if (existing && !body.attachExisting) {
            /*
             * 409 with a MACHINE-READABLE flag, so the form can offer the attach
             * action rather than making the admin guess that one exists. Without
             * the flag the client would have to match on the message text, which
             * is the kind of coupling that breaks the moment the wording changes.
             */
            throw createError({
                statusCode: 409,
                statusMessage: `A login for ${body.email} already exists. It can be attached to `
                    + `${person.givenName} ${person.familyName} instead of creating a second one — `
                    + 'they would keep their existing password, and this institution would no longer '
                    + 'be able to reset it, because the login would then be shared.',
                data: { field: 'email', accountExists: true },
            });
        }

        const password = existing ? null : (body.password ?? generatePassword());
        const mustChangePassword = body.mustChangePassword ?? true;

        const accountId = await mapDbErrors(async () => {
            if (existing) {
                /*
                 * ATTACH ONLY. The password, the activation state and the
                 * force-change flag all belong to whoever already administers
                 * this credential; touching any of them here would let one
                 * institution reconfigure another's login by claiming an email.
                 */
                await linkAccountToPerson(tx, existing.id, person.id);

                return existing.id;
            }

            const created = await createAccountRow(tx, {
                email: body.email,
                passwordHash: await hashPassword(password as string),
                mustChangePassword,
                isActive: body.isActive,
            });

            await linkAccountToPerson(tx, created.id, person.id);

            return created.id;
        });

        const scope = await accountScope(tx, identity.tenantId, accountId);
        const view = await accountView(tx, scope);

        await auditAccount({
            action: existing ? 'account.attached' : 'account.created',
            tenantId: identity.tenantId,
            accountId,
            email: body.email,
            actorPersonId: identity.actorPersonId ?? 'unknown',
            personId: person.id,
            mustChangePassword: existing ? null : mustChangePassword,
        });

        setResponseStatus(event, 201);

        /*
         * THE PASSWORD IS IN THE RESPONSE AND NOWHERE ELSE — this is the one and
         * only moment it is legible, exactly as the operator CLIs print it once.
         * Null when an existing credential was attached, because none was set and
         * echoing a placeholder would read as "here is their password".
         */
        return { ...view, oneTimePassword: password, attached: Boolean(existing) };
    });
});
