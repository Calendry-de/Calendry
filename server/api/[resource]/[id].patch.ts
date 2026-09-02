import { writeAuditLog } from '../../utils/auditLog';
import { mapDbErrors } from '../../utils/dbErrors';
import { delegate, demoteExclusiveSiblings, getResource, splitChildren } from '../../utils/resources';
import { crudPermission } from '../../utils/permissions';
import { requireAnyPermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

defineRouteMeta({
    openAPI: {
        tags: ['Resources'],
        summary: 'Update one row by id',
        description: 'Generic update route (permission <resource>.update). The body is the per-resource update schema, matched by the resource path segment (see the oneOf variants); all fields are optional and identifier keys (key, type, termId) are create-only. A cross-tenant id updates zero rows and reports 404. Federation-owned rows are readable but never writable here.',
        parameters: [
            { name: 'resource', in: 'path', required: true, schema: { type: 'string', enum: ['persons', 'roles', 'groups', 'rooms', 'equipment', 'offerings', 'offering-templates', 'offering-plans', 'time-grids', 'terms', 'constraints', 'session-kinds', 'calendar-periods', 'access-roles'] } },
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        oneOf: [
                            {
                                title: 'persons',
                                type: 'object',
                                properties: {
                                    givenName: {
                                        type: 'string',
                                    },
                                    familyName: {
                                        type: 'string',
                                    },
                                    email: {
                                        type: 'string',
                                        format: 'email',
                                        nullable: true,
                                    },
                                    externalRef: {
                                        type: 'string',
                                        nullable: true,
                                    },
                                    timezone: {
                                        type: 'string',
                                        nullable: true,
                                        description: 'Display-only; never affects grid resolution or constraint evaluation.',
                                    },
                                    isActive: {
                                        type: 'boolean',
                                    },
                                },
                                description: 'All fields optional.',
                            },
                            {
                                title: 'roles',
                                type: 'object',
                                description: 'All fields optional; identifier keys are create-only and absent here.',
                                properties: {
                                    name: {
                                        type: 'string',
                                    },
                                    description: {
                                        type: 'string',
                                        nullable: true,
                                    },
                                },
                            },
                            {
                                title: 'groups',
                                type: 'object',
                                properties: {
                                    parentGroupId: {
                                        type: 'string',
                                        nullable: true,
                                        description: 'Groups nest; the closure is rebuilt by a database trigger.',
                                    },
                                    name: {
                                        type: 'string',
                                    },
                                    description: {
                                        type: 'string',
                                        nullable: true,
                                    },
                                    expectedSize: {
                                        type: 'integer',
                                        minimum: 0,
                                        nullable: true,
                                    },
                                    curriculumPlanId: {
                                        type: 'string',
                                        nullable: true,
                                        description: 'The curriculum plan this group INTENDS to follow, before it has a single offering: an administrative hint, never derived from or resolved against its actual offerings.',
                                    },
                                },
                                description: 'All fields optional.',
                            },
                            {
                                title: 'rooms',
                                type: 'object',
                                properties: {
                                    code: {
                                        type: 'string',
                                    },
                                    name: {
                                        type: 'string',
                                    },
                                    capacity: {
                                        type: 'integer',
                                        minimum: 0,
                                    },
                                    location: {
                                        type: 'string',
                                        nullable: true,
                                    },
                                    ranking: {
                                        type: 'integer',
                                    },
                                    isVirtual: {
                                        type: 'boolean',
                                    },
                                    isActive: {
                                        type: 'boolean',
                                    },
                                },
                                description: 'All fields optional.',
                            },
                            {
                                title: 'equipment',
                                type: 'object',
                                properties: {
                                    name: {
                                        type: 'string',
                                    },
                                    description: {
                                        type: 'string',
                                        nullable: true,
                                    },
                                },
                                description: 'All fields optional; identifier keys are create-only and absent here.',
                            },
                            {
                                title: 'offerings',
                                type: 'object',
                                properties: {
                                    kindId: {
                                        type: 'string',
                                        description: 'A session kind of this tenant.',
                                    },
                                    code: {
                                        type: 'string',
                                        nullable: true,
                                    },
                                    title: {
                                        type: 'string',
                                    },
                                    color: {
                                        type: 'string',
                                        nullable: true,
                                        description: 'Free-form; null inherits the session kind color.',
                                    },
                                    frequency: {
                                        type: 'integer',
                                        minimum: 1,
                                        description: 'How many Sessions per week the solver must place.',
                                    },
                                    durationBlocks: {
                                        type: 'integer',
                                        minimum: 1,
                                    },
                                    schedulingPattern: {
                                        type: 'string',
                                        enum: ['DISTRIBUTED', 'BLOCK'],
                                        nullable: true,
                                        description: 'Empty string is treated as null (unclassified).',
                                    },
                                    requiredRoleId: {
                                        type: 'string',
                                        nullable: true,
                                    },
                                    requiredCapacity: {
                                        type: 'integer',
                                        minimum: 0,
                                        nullable: true,
                                    },
                                    requiredRoomCount: {
                                        type: 'integer',
                                        minimum: 1,
                                        maximum: 4,
                                        description: 'Hard-capped at 4; above it the solver refuses the whole input.',
                                    },
                                    allowOnline: {
                                        type: 'boolean',
                                    },
                                    isActive: {
                                        type: 'boolean',
                                    },
                                    notes: {
                                        type: 'string',
                                        nullable: true,
                                    },
                                },
                                description: 'All fields optional; identifier keys are create-only and absent here.',
                            },
                            {
                                title: 'offering-templates',
                                type: 'object',
                                description: 'A reusable Offering shape (issue #8); all fields optional, including name.',
                                properties: {
                                    name: {
                                        type: 'string',
                                    },
                                    title: {
                                        type: 'string',
                                        nullable: true,
                                    },
                                    kindId: {
                                        type: 'string',
                                        nullable: true,
                                        description: 'A session kind of this tenant.',
                                    },
                                    code: {
                                        type: 'string',
                                        nullable: true,
                                    },
                                    color: {
                                        type: 'string',
                                        nullable: true,
                                    },
                                    frequency: {
                                        type: 'integer',
                                        minimum: 1,
                                        nullable: true,
                                    },
                                    durationBlocks: {
                                        type: 'integer',
                                        minimum: 1,
                                        nullable: true,
                                    },
                                    schedulingPattern: {
                                        type: 'string',
                                        enum: ['DISTRIBUTED', 'BLOCK'],
                                        nullable: true,
                                        description: 'Empty string is treated as null (unclassified).',
                                    },
                                    requiredRoleId: {
                                        type: 'string',
                                        nullable: true,
                                    },
                                    requiredCapacity: {
                                        type: 'integer',
                                        minimum: 0,
                                        nullable: true,
                                    },
                                    requiredRoomCount: {
                                        type: 'integer',
                                        minimum: 1,
                                        maximum: 4,
                                        nullable: true,
                                        description: 'Hard-capped at 4; above it the solver refuses the whole input.',
                                    },
                                    allowOnline: {
                                        type: 'boolean',
                                        nullable: true,
                                    },
                                    notes: {
                                        type: 'string',
                                        nullable: true,
                                    },
                                },
                            },
                            {
                                title: 'offering-plans',
                                type: 'object',
                                description: 'A reusable, ordered bundle of offering-templates; all fields optional. Item membership/order and the apply action are separate resources, not nested under this one.',
                                properties: {
                                    name: {
                                        type: 'string',
                                    },
                                    description: {
                                        type: 'string',
                                        nullable: true,
                                    },
                                    nextPlanId: {
                                        type: 'string',
                                        nullable: true,
                                        description: 'Chains plans into a sequence; null if this is the last (or only) plan.',
                                    },
                                },
                            },
                            {
                                title: 'time-grids',
                                type: 'object',
                                properties: {
                                    name: {
                                        type: 'string',
                                    },
                                    blockLengthMinutes: {
                                        type: 'integer',
                                        minimum: 1,
                                    },
                                    blocksPerDay: {
                                        type: 'integer',
                                        minimum: 1,
                                    },
                                    activeDays: {
                                        type: 'array',
                                        items: {
                                            type: 'integer',
                                            minimum: 1,
                                            maximum: 7,
                                        },
                                        minItems: 1,
                                        description: 'ISO weekdays, 1 = Monday.',
                                    },
                                    startHour: {
                                        type: 'integer',
                                        minimum: 0,
                                        maximum: 23,
                                    },
                                    startMinute: {
                                        type: 'integer',
                                        minimum: 0,
                                        maximum: 59,
                                    },
                                    breakMinutes: {
                                        type: 'integer',
                                        minimum: 0,
                                    },
                                    breaks: {
                                        type: 'array',
                                        items: {
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
                                        },
                                        description: 'Replaced wholesale when present.',
                                    },
                                    isDefault: {
                                        type: 'boolean',
                                        description: 'Exclusive flag; setting it demotes the current default in the same transaction.',
                                    },
                                },
                                description: 'All fields optional.',
                            },
                            {
                                title: 'terms',
                                type: 'object',
                                properties: {
                                    name: {
                                        type: 'string',
                                    },
                                    startDate: {
                                        type: 'string',
                                        format: 'date',
                                        description: 'ISO 8601 date; date-times are coerced.',
                                    },
                                    endDate: {
                                        type: 'string',
                                        format: 'date',
                                        description: 'ISO 8601 date; date-times are coerced.',
                                    },
                                    timeGridId: {
                                        type: 'string',
                                        nullable: true,
                                    },
                                },
                                description: 'All fields optional.',
                            },
                            {
                                title: 'constraints',
                                type: 'object',
                                properties: {
                                    name: {
                                        type: 'string',
                                    },
                                    severity: {
                                        type: 'string',
                                        enum: ['HARD', 'SOFT'],
                                    },
                                    weight: {
                                        type: 'integer',
                                        nullable: true,
                                        description: 'HARD rows carry null. Unbounded above by design (only ratios matter); negative values are refused.',
                                    },
                                    params: {
                                        type: 'object',
                                        description: 'Parameter values validated against the constraint-type catalogue.',
                                    },
                                    isEnabled: {
                                        type: 'boolean',
                                    },
                                    timeGridId: {
                                        type: 'string',
                                        nullable: true,
                                        description: 'null applies the rule to every grid.',
                                    },
                                    scopes: {
                                        type: 'array',
                                        nullable: true,
                                        items: {
                                            type: 'object',
                                            required: ['kindId'],
                                            properties: {
                                                kindId: {
                                                    type: 'string',
                                                },
                                            },
                                        },
                                        description: 'Session-kind scopes. A non-default constraint of a type that already has a default must name at least one.',
                                    },
                                    members: {
                                        type: 'array',
                                        nullable: true,
                                        items: {
                                            type: 'object',
                                            required: ['offeringId'],
                                            properties: {
                                                offeringId: {
                                                    type: 'string',
                                                },
                                            },
                                        },
                                        description: 'Ordered operands of a relation-type constraint; array order is the order.',
                                    },
                                },
                                description: 'All fields optional; identifier keys are create-only and absent here.',
                            },
                            {
                                title: 'session-kinds',
                                type: 'object',
                                properties: {
                                    name: {
                                        type: 'string',
                                    },
                                    color: {
                                        type: 'string',
                                        nullable: true,
                                    },
                                    requiresGroup: {
                                        type: 'boolean',
                                    },
                                    type: {
                                        type: 'string',
                                        enum: ['TEACHING', 'EXAM', 'ADMIN'],
                                        description: 'Fixed classification behind the tenant-open key/name.',
                                    },
                                },
                                description: 'All fields optional; identifier keys are create-only and absent here.',
                            },
                            {
                                title: 'calendar-periods',
                                type: 'object',
                                properties: {
                                    kind: {
                                        type: 'string',
                                        enum: ['HOLIDAY', 'BREAK', 'EXAM'],
                                    },
                                    name: {
                                        type: 'string',
                                    },
                                    startDate: {
                                        type: 'string',
                                        format: 'date',
                                        description: 'ISO 8601 date; date-times are coerced.',
                                    },
                                    endDate: {
                                        type: 'string',
                                        format: 'date',
                                        description: 'ISO 8601 date; date-times are coerced.',
                                    },
                                },
                                description: 'All fields optional; identifier keys are create-only and absent here.',
                            },
                            {
                                title: 'access-roles',
                                type: 'object',
                                description: 'Requires access_role.manage. All fields optional; key is create-only.',
                                properties: {
                                    name: {
                                        type: 'string',
                                    },
                                    description: {
                                        type: 'string',
                                        nullable: true,
                                    },
                                    permissions: {
                                        type: 'array',
                                        minItems: 1,
                                        items: {
                                            type: 'object',
                                            required: ['permissionKey'],
                                            properties: {
                                                permissionKey: {
                                                    type: 'string',
                                                    description: 'A key from the fixed permission catalogue (shared/permissions.ts).',
                                                },
                                            },
                                        },
                                        description: 'Replaced wholesale; a role holding nothing is refused.',
                                    },
                                },
                            },
                        ],
                    },
                },
            },
        },
        responses: {
            200: { description: 'The updated row.' },
            400: { description: 'Body failed the resource schema.' },
            404: { description: 'Not found in this tenant.' },
            409: { description: 'Entity-specific refusal (e.g. narrowing a TimeGrid under placed Sessions).' },
        },
    },
});

/** Update one row by id, scoped to the caller's tenant. */
export default defineEventHandler(async (event) => {
    const resource = getRouterParam(event, 'resource');
    const config = getResource(resource);
    const id = getRouterParam(event, 'id');
    const body = await readValidatedBody(event, config.update.parse);

    return withRequestTenant(event, async (tx, identity) => {
        await requireAnyPermission(event, tx, crudPermission(resource as string, 'update'));

        // updateMany, not update: it takes a full where clause, so the tenant
        // predicate is part of the statement. A cross-tenant id updates zero
        // rows instead of throwing something that distinguishes "exists but
        // forbidden" from "does not exist".
        //
        // Reparenting a Group is permitted here; group_closure is rebuilt by the
        // database trigger from Step 3. This route must not touch it.
        // Entity-specific refusal, inside the same transaction, before
        // anything is written. Throwing here leaves the row untouched.
        await config.beforeUpdate?.({
            tx,
            tenantId: identity.tenantId,
            id: id as string,
            patch: body as Record<string, unknown>,
        });

        const { columns, children } = splitChildren(config, body as Record<string, unknown>);

        /*
         * issue #78: an AccessRole's permission set changing is audited.
         * Read BEFORE the write, in the same transaction, so `before` names
         * the set this request actually replaced rather than whatever the
         * table happens to hold when the audit line is written.
         */
        const isAccessRolePermissionChange = resource === 'access-roles' && children.permissions !== undefined;

        const previousPermissionKeys = isAccessRolePermissionChange
            ? (await tx.accessRolePermission.findMany({
                where: { accessRoleId: id as string, tenantId: identity.tenantId },
                select: { permissionKey: true },
            })).map((row) => row.permissionKey)
            : [];

        const result = await mapDbErrors(async () => {
            // Same transaction as the update below, so the two-defaults state is
            // never observable and a failed update demotes nothing.
            await demoteExclusiveSiblings(
                tx,
                config,
                identity.tenantId,
                columns,
                id,
            );

            const updated = await delegate(tx, config.model).updateMany({
                where: { id, tenantId: identity.tenantId },
                data: columns,
            });

            // Same transaction: a grid whose blocks moved but whose breaks did
            // not is a timetable nobody chose.
            if (updated.count > 0 && config.writeChildren && Object.keys(children).length) {
                await config.writeChildren({ tx, tenantId: identity.tenantId, id: id as string, children });
            }

            // Only when something was actually written: a cross-tenant id
            // updates zero rows and must report 404 rather than being measured
            // against a tenant it did not touch.
            if (updated.count > 0) {
                await config.afterWrite?.({ tx, tenantId: identity.tenantId, id: id as string, action: 'update' });
            }

            return updated;
        });

        if (result.count === 0) {
            throw createError({ statusCode: 404, message: 'Not found.' });
        }

        if (isAccessRolePermissionChange) {
            const role = await tx.accessRole.findFirst({
                where: { id: id as string, tenantId: identity.tenantId },
                select: { name: true },
            });

            const nextPermissionKeys = (children.permissions as { permissionKey: string }[]).map((row) => row.permissionKey);

            await writeAuditLog({
                action: 'access_role.permissions_updated',
                outcome: 'SUCCESS',
                actorPersonId: identity.actorPersonId,
                target: role?.name ?? (id as string),
                tenantId: identity.tenantId,
                detail: { accessRoleId: id, before: previousPermissionKeys, after: nextPermissionKeys },
            });
        }

        return delegate(tx, config.model).findFirst({ where: { id, tenantId: identity.tenantId } });
    });
});
