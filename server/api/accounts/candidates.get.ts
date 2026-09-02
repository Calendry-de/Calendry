import { CANDIDATE_LIMIT } from '../../../shared/accounts';
import { crudPermission } from '../../utils/permissions';
import { requireAnyPermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

/**
 * People in this institution who could be given a login: active, and not
 * already holding one.
 *
 * WHY NOT A `reference` FIELD ON `persons`. The generic reference control fetches
 * `/api/persons` and offers every row, so the majority of its options would be
 * people who already have a login, and choosing one produces a 409 from
 * `@@unique([personId])` after the form has been filled in. A picker whose
 * options are mostly invalid is a worse control than a shorter one, and the
 * constraint it is respecting is structural, not a preference.
 *
 * DEACTIVATED PEOPLE ARE EXCLUDED for a different reason: sign-in resolves
 * identities through active people only, so a login attached to one would
 * authenticate and then be told it belongs to no institution: a working
 * password with no way in, which is exactly the kind of state that reads as a
 * broken deployment rather than as a deactivated person.
 *
 * Gated on `create`, not `read`: this list exists only to be attached to
 * something, and someone who may merely audit logins has no use for it.
 */
export default defineEventHandler(async (event) => {
    const query = getQuery(event);
    /**
     * The person the edited login is currently attached to, kept in the list so
     * the select can render its own value. Without it the control would open on
     * an option that is not there and read as unset.
     */
    const include = typeof query.include === 'string' ? query.include : undefined;

    return withRequestTenant(event, async (tx, identity) => {
        await requireAnyPermission(event, tx, crudPermission('accounts', 'create'));

        return tx.person.findMany({
            where: {
                tenantId: identity.tenantId,
                OR: [
                    { isActive: true, accountLink: { is: null } },
                    ...(include ? [{ id: include }] : []),
                ],
            },
            select: { id: true, givenName: true, familyName: true, email: true, isActive: true },
            orderBy: [{ familyName: 'asc' }, { givenName: 'asc' }],
            /*
             * Bounded, and the CLIENT REPORTS the cap rather than quietly
             * presenting a truncated roster as the whole of it: a select that
             * silently omits people reads as "that person does not exist here".
             * `CANDIDATE_LIMIT` is exported so the form compares against the same
             * number rather than repeating it. A tenant with more unattached
             * people than this needs a search box, not a longer dropdown; see
             * the project board, "A searchable person picker".
             */
            take: CANDIDATE_LIMIT,
        });
    });
});
