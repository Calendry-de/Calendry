import { mapDbErrors } from '../../utils/dbErrors';
import { delegate, demoteExclusiveSiblings, getResource, splitChildren } from '../../utils/resources';
import { crudPermission } from '../../utils/permissions';
import { requireAnyPermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

defineRouteMeta({
    openAPI: {
        tags: ['Resources'],
        summary: 'Create a row of a core entity',
        description: 'Generic create route (permission <resource>.create; access-roles requires access_role.manage instead). The body is the per-resource create schema, matched by the resource path segment (see the oneOf variants); tenant ownership always comes from the session, never from the body. Creating a row that claims an exclusive flag (e.g. a default) demotes the incumbent in the same transaction.',
        parameters: [
            { name: 'resource', in: 'path', required: true, schema: { type: 'string', enum: ['persons', 'roles', 'groups', 'rooms', 'equipment', 'offerings', 'offering-templates', 'offering-plans', 'time-grids', 'terms', 'constraints', 'session-kinds', 'calendar-periods', 'access-roles'] } },
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
                                required: ['givenName', 'familyName'],
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
                            },
                            {
                                title: 'roles',
                                type: 'object',
                                description: 'Scheduling vocabulary (e.g. lecturer), NOT authorization; access-roles grant permissions.',
                                required: ['key', 'name'],
                                properties: {
                                    key: {
                                        type: 'string',
                                        description: 'Stable identifier; not editable after creation.',
                                    },
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
                                required: ['name'],
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
                                        description: 'The curriculum plan this group INTENDS to follow, before it has a single offering — an administrative hint, never derived from or resolved against its actual offerings.',
                                    },
                                },
                            },
                            {
                                title: 'rooms',
                                type: 'object',
                                required: ['code', 'name'],
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
                            },
                            {
                                title: 'equipment',
                                type: 'object',
                                required: ['key', 'name'],
                                properties: {
                                    key: {
                                        type: 'string',
                                        description: 'Stable identifier; not editable after creation.',
                                    },
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
                                title: 'offerings',
                                type: 'object',
                                required: ['termId', 'kindId', 'title'],
                                properties: {
                                    termId: {
                                        type: 'string',
                                        description: 'Fixed at creation; a Session cannot move to an Offering in another term.',
                                    },
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
                            },
                            {
                                title: 'offering-templates',
                                type: 'object',
                                description: 'A reusable Offering shape (issue #8); every field is optional except `name` — a template states only the part of the shape it wants to fix. Never federation-ownable.',
                                required: ['name'],
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
                                description: 'A reusable, ordered bundle of offering-templates; item membership/order and the apply action are separate resources (`offering-plan-items`, `offering-plan-apply`), not nested under this one.',
                                required: ['name'],
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
                                required: ['name', 'blockLengthMinutes', 'blocksPerDay', 'activeDays'],
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
                            },
                            {
                                title: 'terms',
                                type: 'object',
                                required: ['name', 'startDate', 'endDate'],
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
                            },
                            {
                                title: 'constraints',
                                type: 'object',
                                required: ['type', 'name', 'severity'],
                                properties: {
                                    type: {
                                        type: 'string',
                                        description: 'A key from the constraint-type catalogue; not editable after creation.',
                                    },
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
                            },
                            {
                                title: 'session-kinds',
                                type: 'object',
                                required: ['key', 'name'],
                                properties: {
                                    key: {
                                        type: 'string',
                                        description: 'Stable identifier; not editable after creation.',
                                    },
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
                            },
                            {
                                title: 'calendar-periods',
                                type: 'object',
                                required: ['termId', 'kind', 'name', 'startDate', 'endDate'],
                                properties: {
                                    termId: {
                                        type: 'string',
                                        description: 'Fixed at creation; moving a period to another term is creating a different period.',
                                    },
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
                            },
                            {
                                title: 'access-roles',
                                type: 'object',
                                description: 'Requires access_role.manage, not a CRUD permission. AccessRole is authorization; the roles resource is scheduling vocabulary.',
                                required: ['key', 'name', 'permissions'],
                                properties: {
                                    key: {
                                        type: 'string',
                                        description: 'Stable identifier; not editable after creation.',
                                    },
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
            201: { description: 'The created row.' },
            400: { description: 'Body failed the resource schema.' },
            409: { description: 'Entity-specific refusal (e.g. a uniqueness conflict).' },
        },
    },
});

/** Create a row owned by the caller's tenant. */
export default defineEventHandler(async (event) => {
    const resource = getRouterParam(event, 'resource');
    const config = getResource(resource);
    const body = await readValidatedBody(event, config.create.parse);

    return withRequestTenant(event, async (tx, identity) => {
        await requireAnyPermission(event, tx, crudPermission(resource as string, 'create'));

        // tenant_id comes from resolved identity, never from the request body —
        // otherwise a caller could mint rows into another tenant. The RLS WITH
        // CHECK clause would reject that anyway; this makes it unrepresentable.
        //
        // Federation-owned rows are deliberately NOT creatable here: TAXONOMY.md
        // §2 treats shared resources as a privileged path, and the RLS write
        // policy only permits tenant-owned writes.
        const { columns, children } = splitChildren(config, body as Record<string, unknown>);
        const data = { ...columns, tenantId: identity.tenantId };

        // Entity-specific refusal, in this transaction, before anything is
        // written. Throwing here leaves nothing behind.
        await config.beforeCreate?.({ tx, tenantId: identity.tenantId, data, children });

        const created = await mapDbErrors(async () => {
            // Creating a row that claims an exclusive flag demotes the incumbent,
            // in this transaction. Without it, "create this as the default" is a
            // 409 telling the user to go and edit a different row first.
            await demoteExclusiveSiblings(tx, config, identity.tenantId, data);

            const row = await delegate(tx, config.model).create({ data }) as { id: string };

            if (config.writeChildren && Object.keys(children).length) {
                await config.writeChildren({ tx, tenantId: identity.tenantId, id: row.id, children });
            }

            // Invariants about the RESULT, measured after the write and inside
            // the same transaction. Throwing here rolls the insert back.
            await config.afterWrite?.({ tx, tenantId: identity.tenantId, id: row.id, action: 'create' });

            return row;
        });

        setResponseStatus(event, 201);

        return created;
    });
});
