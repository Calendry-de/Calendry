import { z } from 'zod';
import { writeAuditLog } from '../../../utils/auditLog';
import { mapDbErrors } from '../../../utils/dbErrors';
import { getRelation, relationDelegate } from '../../../utils/relations';
import { delegate, getResource } from '../../../utils/resources';
import { crudPermission } from '../../../utils/permissions';
import { requireAnyPermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';

defineRouteMeta({
    openAPI: {
        tags: ['Resources'],
        summary: 'Replace a relation membership set',
        description: 'Replaces the ENTIRE membership set in one idempotent write; there is no per-row add or remove. THE BODY IS A BARE ARRAY of relation items (max 500), not an envelope. Requires the parent resource update permission unless the relation declares its own (persons/access-roles requires person_access_role.assign). Valid pairs: time-grids/breaks, groups/terms, groups/sources, groups/availability, offerings/groups, offerings/lecturers, offerings/equipment, rooms/equipment, persons/roles, persons/access-roles, persons/groups, constraints/scopes.',
        parameters: [
            { name: 'resource', in: 'path', required: true, schema: { type: 'string', enum: ['persons', 'roles', 'groups', 'rooms', 'equipment', 'offerings', 'time-grids', 'terms', 'constraints', 'session-kinds', 'calendar-periods', 'access-roles'] } },
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'relation', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'array',
                        maxItems: 500,
                        items: {
                            type: 'object',
                            oneOf: [
                                {
                                    type: 'object',
                                    required: ['afterBlockIndex', 'durationMinutes', 'label'],
                                    properties: {
                                        afterBlockIndex: {
                                            type: 'integer',
                                            minimum: 0,
                                        },
                                        durationMinutes: {
                                            type: 'integer',
                                            minimum: 1,
                                        },
                                        label: {
                                            type: 'string',
                                        },
                                        dayOfWeek: {
                                            type: 'integer',
                                            minimum: 1,
                                            maximum: 7,
                                            nullable: true,
                                            description: 'null applies the break to every active day.',
                                        },
                                    },
                                    title: 'time-grids/breaks',
                                },
                                {
                                    title: 'groups/terms',
                                    type: 'object',
                                    required: ['termId'],
                                    description: 'Terms the group is scoped to. NO ROWS MEANS EVERY TERM: saving an empty array widens the group back to universal.',
                                    properties: {
                                        termId: {
                                            type: 'string',
                                        },
                                    },
                                },
                                {
                                    title: 'groups/sources',
                                    type: 'object',
                                    required: ['sourceGroupId'],
                                    description: 'Groups a combined group draws members from; copying the members in is a separate action.',
                                    properties: {
                                        sourceGroupId: {
                                            type: 'string',
                                        },
                                    },
                                },
                                {
                                    title: 'groups/availability',
                                    type: 'object',
                                    required: ['termId'],
                                    description: 'When the group is available INSIDE a term. Absent row = the whole term; at least one bound is required.',
                                    properties: {
                                        termId: {
                                            type: 'string',
                                        },
                                        availableFrom: {
                                            type: 'string',
                                            format: 'date',
                                            description: 'ISO 8601 date; date-times are coerced.',
                                            nullable: true,
                                        },
                                        availableTo: {
                                            type: 'string',
                                            format: 'date',
                                            description: 'ISO 8601 date; date-times are coerced.',
                                            nullable: true,
                                        },
                                    },
                                },
                                {
                                    title: 'offerings/groups',
                                    type: 'object',
                                    required: ['groupId'],
                                    properties: {
                                        groupId: {
                                            type: 'string',
                                        },
                                    },
                                },
                                {
                                    title: 'offerings/lecturers',
                                    type: 'object',
                                    required: ['personId'],
                                    properties: {
                                        personId: {
                                            type: 'string',
                                        },
                                        roleId: {
                                            type: 'string',
                                            nullable: true,
                                            description: 'The scheduling role this person fills here, not an access role.',
                                        },
                                    },
                                },
                                {
                                    title: 'offerings/equipment',
                                    type: 'object',
                                    required: ['equipmentId'],
                                    properties: {
                                        equipmentId: {
                                            type: 'string',
                                        },
                                        quantity: {
                                            type: 'integer',
                                            minimum: 1,
                                            nullable: true,
                                        },
                                    },
                                },
                                {
                                    title: 'rooms/equipment',
                                    type: 'object',
                                    required: ['equipmentId'],
                                    properties: {
                                        equipmentId: {
                                            type: 'string',
                                        },
                                        quantity: {
                                            type: 'integer',
                                            minimum: 1,
                                            nullable: true,
                                        },
                                    },
                                },
                                {
                                    title: 'persons/roles',
                                    type: 'object',
                                    required: ['roleId'],
                                    properties: {
                                        roleId: {
                                            type: 'string',
                                        },
                                    },
                                },
                                {
                                    title: 'persons/access-roles',
                                    type: 'object',
                                    required: ['accessRoleId'],
                                    description: 'Requires person_access_role.assign, not person.update. The write is refused if it would leave the tenant without an administrator.',
                                    properties: {
                                        accessRoleId: {
                                            type: 'string',
                                        },
                                    },
                                },
                                {
                                    title: 'persons/groups',
                                    type: 'object',
                                    required: ['groupId'],
                                    properties: {
                                        groupId: {
                                            type: 'string',
                                        },
                                    },
                                },
                                {
                                    title: 'constraints/scopes',
                                    type: 'object',
                                    description: 'Either field narrows the constraint; at least one is required. Note: offering-scoped constraints are SKIPPED by the solver-input assembly.',
                                    properties: {
                                        offeringId: {
                                            type: 'string',
                                            nullable: true,
                                        },
                                        kindId: {
                                            type: 'string',
                                            nullable: true,
                                        },
                                    },
                                },
                            ],
                        },
                    },
                },
            },
        },
        responses: {
            200: { description: 'The new membership set.' },
            400: { description: 'Body failed the relation item schema.' },
            404: { description: 'Parent row not found in this tenant (federation-owned parents are readable but not writable).' },
        },
    },
});

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

        /*
         * issue #78 — granting or revoking a Person's AccessRoles is audited.
         * `resource`/`relation` come straight off the URL, not `config`,
         * which has no field naming which relation it is.
         */
        const isAccessRoleGrantChange = resource === 'persons' && relation === 'access-roles';

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

            // Read BEFORE the delete, in the same transaction, so `before`
            // names the set this request actually replaced.
            const previousAccessRoleIds = isAccessRoleGrantChange
                ? ((await relationDelegate(tx, config.model).findMany({
                    where: { [config.parentKey]: id, tenantId: identity.tenantId },
                    select: config.select,
                })) as { accessRoleId: string }[]).map((row) => row.accessRoleId)
                : [];

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

            if (isAccessRoleGrantChange) {
                const nextAccessRoleIds = (written as { accessRoleId: string }[]).map((row) => row.accessRoleId);

                await writeAuditLog({
                    action: 'person_access_role.set_updated',
                    outcome: 'SUCCESS',
                    actorPersonId: identity.actorPersonId,
                    target: id as string,
                    tenantId: identity.tenantId,
                    detail: {
                        personId: id,
                        before: previousAccessRoleIds,
                        after: nextAccessRoleIds,
                        granted: nextAccessRoleIds.filter((roleId) => !previousAccessRoleIds.includes(roleId)),
                        revoked: previousAccessRoleIds.filter((roleId) => !nextAccessRoleIds.includes(roleId)),
                    },
                });
            }

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
