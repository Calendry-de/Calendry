import { z } from 'zod';
import {
    accountScope,
    accountView,
    assertSoleTenant,
    auditAccount,
    resolveAttachablePerson,
} from '../../utils/accountAdmin';
import { mapDbErrors } from '../../utils/dbErrors';
import { crudPermission } from '../../utils/permissions';
import { requireAnyPermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

/**
 * Edit a login.
 *
 * THE PASSWORD IS NOT A FIELD HERE. It is an explicit verb
 * (`POST /accounts/:id/reset-password`), for the same reason Session has
 * `move`/`swap` instead of a generic PATCH: a reset revokes every session and
 * hands back a one-time secret, and a request whose body merely happened to
 * contain a password would not read as that. `mustChangePassword` IS a field,
 * because forcing a rotation without issuing a new secret is a different, milder
 * act — the person signs in with the password they already know and is then
 * required to change it.
 *
 * WHICH FIELDS A SHARED LOGIN ACCEPTS is the one asymmetry worth knowing.
 * `email`, `isActive` and `mustChangePassword` all change how the credential
 * behaves in EVERY institution it serves, so they are refused unless this tenant
 * is the only one — see `assertSoleTenant`. `personId` is always accepted: it
 * only names which of this tenant's people the login acts as, which is precisely
 * the part no other tenant can observe.
 */
const bodySchema = z.object({
    email: z.string().email().transform((value) => value.toLowerCase()).optional(),
    isActive: z.boolean().optional(),
    mustChangePassword: z.boolean().optional(),
    /**
     * Which Person in THIS tenant the login acts as — a REASSIGNMENT, never a
     * removal.
     *
     * `null` is accepted by the schema and then refused with an explanation,
     * rather than rejected as a type error: the management form's person select
     * has a placeholder option, so clearing it and pressing Save is a real thing
     * a user does, and "expected string, received null" is not an answer to it.
     * Detaching is `POST /accounts/:id/detach` — an explicit verb, because it
     * removes the login from this institution and only makes sense for one
     * another institution still holds.
     */
    personId: z.string().min(1).nullable().optional(),
});

/** Keys that reconfigure the credential itself, in the order a form shows them. */
const CREDENTIAL_KEYS = ['email', 'isActive', 'mustChangePassword'] as const;

export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id') as string;
    const body = await readValidatedBody(event, bodySchema.parse);

    return withRequestTenant(event, async (tx, identity) => {
        await requireAnyPermission(event, tx, crudPermission('accounts', 'update'));

        const scope = await accountScope(tx, identity.tenantId, id);

        /*
         * Only for keys the body ACTUALLY carries, and compared against the
         * stored value. The management form PATCHes every field it renders on
         * every save, so refusing on presence alone would make a shared login
         * uneditable in the one way it is meant to be editable — the same reason
         * `beforeUpdate` on constraints validates touched fields rather than the
         * merged row.
         */
        const touched = CREDENTIAL_KEYS.filter(
            (key) => body[key] !== undefined && body[key] !== scope[key],
        );

        if (touched.length > 0) {
            assertSoleTenant(scope, `changing ${touched.join(', ')}`);
        }

        if (body.personId === null) {
            throw createError({
                statusCode: 422,
                statusMessage: 'A login has to act as somebody. Choose a person, or use '
                    + '“Remove from this institution” — that is a different act, and it is only '
                    + 'possible for a login another institution still holds.',
                data: { field: 'personId' },
            });
        }

        const nextPersonId = body.personId;
        const relinking = nextPersonId !== undefined && nextPersonId !== scope.own.personId;

        const person = relinking
            ? await resolveAttachablePerson(tx, identity.tenantId, nextPersonId as string, scope.id)
            : null;

        await mapDbErrors(async () => {
            if (touched.length > 0) {
                await tx.account.update({
                    where: { id: scope.id },
                    data: {
                        ...(body.email !== undefined ? { email: body.email } : {}),
                        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
                        ...(body.mustChangePassword !== undefined
                            ? { mustChangePassword: body.mustChangePassword }
                            : {}),
                    },
                });
            }

            if (!relinking) {
                return;
            }

            /*
             * Delete THIS tenant's link by its own composite key, never
             * `deleteMany({ accountId })` — that would silently detach the login
             * from every other institution it serves, from a request that says
             * only "this person, not that one".
             */
            await tx.accountPerson.delete({
                where: { accountId_personId: { accountId: scope.id, personId: scope.own.personId } },
            });

            await tx.accountPerson.create({
                data: { accountId: scope.id, personId: (person as { id: string }).id },
            });

            /*
             * Sessions carry `active_person_id`, so a session opened as the
             * previous person would keep acting as an identity this login no
             * longer holds until it expired. Revoked rather than repointed: which
             * identity a session acts as was chosen at sign-in, and choosing a
             * different one for somebody is not this route's business.
             */
            await tx.authSession.updateMany({
                where: { accountId: scope.id, activePersonId: scope.own.personId, revokedAt: null },
                data: { revokedAt: new Date() },
            });
        });

        if (touched.length > 0 || relinking) {
            auditAccount({
                action: 'account.updated',
                tenantId: identity.tenantId,
                accountId: scope.id,
                email: body.email ?? scope.email,
                actorPersonId: identity.actorPersonId ?? 'unknown',
                changed: touched,
                personId: relinking ? nextPersonId : scope.own.personId,
            });
        }

        return accountView(tx, await accountScope(tx, identity.tenantId, scope.id));
    });
});
