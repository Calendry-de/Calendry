import { z } from 'zod';
import { mapDbErrors } from '../../../utils/dbErrors';
import { getRelation, relationDelegate } from '../../../utils/relations';
import { delegate, getResource } from '../../../utils/resources';
import { crudPermission } from '../../../utils/permissions';
import { requireAnyPermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';

/**
 * Replaces a relation's entire membership set.
 *
 * PUT, not POST/DELETE per row: what the user edits is a set ("this offering is
 * for these groups"), and expressing that as one idempotent write removes the
 * partially-applied states a sequence of per-row calls can leave behind.
 *
 * Delete-then-insert inside one transaction rather than a diff. The set is
 * small (tens of rows at most), the diff logic would be three code paths where
 * this is one, and the transaction makes the intermediate empty state
 * unobservable to any other reader.
 */
export default defineEventHandler(async (event) => {
    const resource = getRouterParam(event, 'resource');
    const id = getRouterParam(event, 'id');
    const relation = getRouterParam(event, 'relation');
    const config = getRelation(resource, relation);

    const body = await readValidatedBody(event, z.array(config.item).max(500).parse);

    return withRequestTenant(event, async (tx, identity) => {
        /**
         * Editing what an Offering requires IS editing the Offering — so the
         * default is the parent's own `.update`, per the rule at the top of
         * relations.ts.
         *
         * `writePermission` is the exception, and `persons/access-roles` is why
         * it exists: granting someone authority is NOT editing a person. The
         * catalogue already says so, with `person_access_role.assign` as its own
         * capability, and a tenant that lets a registrar assign roles is not
         * thereby letting them rename people or change their email.
         */
        await requireAnyPermission(
            event,
            tx,
            config.writePermission ?? crudPermission(config.parent, 'update'),
        );

        const parentConfig = getResource(config.parent);

        return mapDbErrors(async () => {
            /**
             * The parent must exist IN THIS TENANT before anything is written.
             *
             * Without this, a PUT naming another tenant's id would delete zero
             * rows and insert rows the RLS WITH CHECK then rejects — a 500
             * dressed up as a server fault, when the honest answer is 404. It
             * also means a caller cannot use the insert's success or failure to
             * probe whether an id exists elsewhere.
             *
             * Federation-owned parents are readable but not writable (the RLS
             * write policy is tenant-only), so this deliberately checks
             * tenant ownership rather than mere visibility.
             */
            const parent = await delegate(tx, parentConfig.model).findFirst({
                where: { id, tenantId: identity.tenantId },
                select: { id: true },
            });

            if (!parent) {
                throw createError({ statusCode: 404, statusMessage: 'Not found.' });
            }

            const rows = body as Record<string, unknown>[];

            await relationDelegate(tx, config.model).deleteMany({
                where: {
                    [config.parentKey]: id,
                    ...(config.tenantColumnNullable ? {} : { tenantId: identity.tenantId }),
                },
            });

            if (rows.length > 0) {
                // tenant_id comes from the resolved identity, never the body —
                // the same rule as every create route.
                await relationDelegate(tx, config.model).createMany({
                    data: rows.map((row) => ({
                        ...row,
                        [config.parentKey]: id,
                        tenantId: identity.tenantId,
                    })),
                    // A duplicate in the submitted set is a client mistake, not
                    // a reason to fail: the resulting SET is the same either way.
                    skipDuplicates: true,
                });
            }

            const written = await relationDelegate(tx, config.model).findMany({
                where: {
                    [config.parentKey]: id,
                    ...(config.tenantColumnNullable ? {} : { tenantId: identity.tenantId }),
                },
                select: config.select,
            }) as Record<string, unknown>[];

            /*
             * An invariant about what the tenant is LEFT with, measured after
             * the replacement and inside the same transaction — so a revocation
             * that would strip the last administrator rolls back rather than
             * being reported once it is too late. Runs BEFORE the warnings,
             * which describe a set that stood.
             */
            await config.afterWrite?.({ tx, tenantId: identity.tenantId, id: id as string });

            /**
             * RESPONSE SHAPE IS CONDITIONAL, deliberately:
             *
             *   no `warnAfterWrite`  ->  a bare array, exactly as before
             *   `warnAfterWrite`     ->  { rows, warnings }
             *
             * Same pattern as the list route's `limit`. A relation that has
             * nothing advisory to say keeps the shape every existing caller
             * already reads, so adding warnings to ONE relation is not a
             * breaking change for the other five.
             *
             * Computed AFTER the replacement and inside the same transaction:
             * running it before would describe the set being replaced, which is
             * the opposite of what the user just chose.
             */
            if (!config.warnAfterWrite) {
                return written;
            }

            const warnings = await config.warnAfterWrite({
                tx,
                tenantId: identity.tenantId,
                id: id as string,
                rows: written,
            });

            return { rows: written, warnings };
        });
    });
});
