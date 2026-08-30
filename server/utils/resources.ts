import { z } from 'zod';
import { MAX_ROOMS_PER_SESSION } from '#shared/rooms';
import { SESSION_KIND_TYPES } from '#shared/sessionKindType';
import type { Tx } from './tenantDb';
import { describeOrphans, sessionsOutsideGrid } from './gridBounds';
import { findConstraintType, validateConstraintShape } from '../../shared/constraintTypes';
import type { ConstraintShapeProblem } from '../../shared/constraintTypes';
import { assertTenantRetainsAdministrator } from './accessRoleGuards';
import { isPermissionKey } from '../../shared/permissions';
import type { PermissionKey } from '../../shared/permissions';

/**
 * Registry driving generic CRUD for the nine tenant-scoped core entities.
 *
 * One registry rather than 45 hand-written route files: the tenant-scoping rule
 * is identical for all of them, and duplicating it nine times is nine chances to
 * forget it. The entities with domain-specific behaviour (Session, Generation)
 * are deliberately NOT here — they get explicit verb routes instead.
 */
export interface ResourceConfig {
    /** Prisma delegate name on the transaction client. */
    model: string;
    /** Zod schema for POST bodies, before tenant_id injection. */
    create: z.ZodTypeAny;
    /** Zod schema for PATCH bodies. */
    update: z.ZodTypeAny;
    /** Query-string filters permitted on list. */
    filters: z.ZodTypeAny;
    /** Default ordering for list responses. */
    orderBy: Record<string, 'asc' | 'desc'>;
    /**
     * Text columns the `q` list parameter searches, case-insensitively.
     *
     * An explicit allowlist rather than "every string column": `q` reaches the
     * database as a filter, and letting the client choose the column is how a
     * search box turns into an enumeration tool for fields no screen shows.
     */
    searchFields?: string[];
    /**
     * A boolean column of which at most one row per tenant may be true.
     *
     * Setting it demotes every sibling in the same transaction, because "make
     * this the default" means "and not the others" — that is one intent, not
     * two. Without this, the partial unique index backing the rule turns an
     * ordinary promotion into a 409 that tells the user to go and un-set the
     * other one first.
     *
     * Declared here rather than special-cased in the route so the behaviour is
     * visible next to the entity it applies to, and so the next exclusive flag
     * is a one-line change instead of a second branch.
     */
    exclusiveFlag?: string;
    /**
     * True for entities a Federation can own (TAXONOMY.md §2). Reads may return
     * federation-owned rows, so list queries must not blindly filter
     * `tenant_id = x` or shared resources vanish.
     */
    federationOwnable?: boolean;
    /**
     * Runs inside the update transaction, BEFORE the row is written. Throw to
     * refuse the edit.
     *
     * Declared here rather than special-cased in the generic PATCH route for the
     * same reason `exclusiveFlag` is: the rule stays next to the entity it
     * governs, and the next one is a property rather than another branch in a
     * handler that serves eleven entities.
     */
    /**
     * Relations to embed on read. Kept minimal — an include is a join on every
     * list request, so it earns its place only when the client genuinely cannot
     * render the row without it.
     *
     * `time-grids` qualifies: break overrides change what every block is
     * CALLED, so a grid without them renders a timetable that is wrong rather
     * than merely sparse.
     */
    include?: Record<string, boolean>;
    /**
     * Body keys that are CHILD ROWS, not columns. Stripped from the row write
     * and handed to `writeChildren` inside the same transaction.
     *
     * Deliberately NOT the RELATIONS mechanism, which is a picker over existing
     * entities (`resource: 'groups'`, `valueKey: 'groupId'`) saved by its own
     * request. A TimeGrid's breaks are not references to anything — they are
     * part of the grid's own definition, and a grid whose blocks moved but
     * whose lunch did not, because one of two requests failed, is a timetable
     * nobody chose. So they save atomically with the row.
     */
    childKeys?: string[];
    writeChildren?: (ctx: {
        tx: Tx;
        tenantId: string;
        id: string;
        children: Record<string, unknown[]>;
    }) => Promise<void>;
    /**
     * Entity-specific refusal on CREATE, inside the transaction, before the
     * insert. The counterpart to `beforeUpdate`, for rules a zod schema cannot
     * express because they need to READ another row — a calendar period has to
     * be checked against its Term's date range, and the Term is a different
     * table.
     */
    beforeCreate?: (ctx: {
        tx: Tx;
        tenantId: string;
        data: Record<string, unknown>;
        /**
         * The CHILD collections, already split out of `data` by
         * `splitChildren`. Passed because a rule can depend on them: a
         * constraint variant is only legal if it names a scope, and `scopes` is
         * a child key — so a guard reading `data` alone sees `undefined` and
         * refuses everything, valid payloads included.
         */
        children: Record<string, unknown>;
    }) => Promise<void>;
    beforeUpdate?: (ctx: {
        tx: Tx;
        tenantId: string;
        id: string;
        patch: Record<string, unknown>;
    }) => Promise<void>;
    /**
     * Entity-specific refusal on DELETE, inside the transaction, before the row
     * goes.
     *
     * BEFORE AND NOT `afterWrite`, which already fires on delete: a rule about
     * what the row still REFERENCES cannot be checked afterwards, because the
     * references are gone too. `person` is the case that forced it — deleting a
     * Person cascades `account_person`, so a guard measuring the aftermath sees a
     * consistent database and an Account nobody can reach.
     */
    beforeDelete?: (ctx: { tx: Tx; tenantId: string; id: string }) => Promise<void>;
    /**
     * Runs INSIDE the write transaction, AFTER the row and its children — on
     * create, update AND delete. Throwing rolls the transaction back.
     *
     * For an invariant about the RESULT rather than the payload.
     * `assertTenantRetainsAdministrator` is why it exists: predicting whether a
     * write leaves a tenant unable to administer itself means reimplementing the
     * write, and a guard that models a write can drift from it.
     *
     * Wired into all three routes, not only those that can currently breach
     * something — a hook that fires on some writes is true when written and
     * quietly false a year later.
     */
    afterWrite?: (ctx: {
        tx: Tx;
        tenantId: string;
        id: string;
        action: 'create' | 'update' | 'delete';
    }) => Promise<void>;
    /**
     * Boolean column marking rows PROVISIONING created, which a tenant must not
     * delete (`role.is_system`, `access_role.is_system`).
     *
     * Declared here as well as in the client registry because until now it was
     * client-only: `ManageEntityForm` hid the delete button and the API happily
     * honoured `DELETE /api/roles/:id` for a system row anyway. Harmless for the
     * domain Role; for an AccessRole it is a direct route to a tenant that
     * cannot administer itself, since `tenant-admin` is the system row.
     *
     * A refusal, not a filter — 409 naming the row, so "provisioning owns this"
     * stays distinguishable from "no such row".
     */
    systemFlag?: string;
    /**
     * Declared filters that are NOT plain column equality. The list route spreads
     * `filters` into `where`, which is wrong for a range (`minCapacity` means
     * `capacity >= n`) and a relation (`groups?termId=` means "scoped to that Term
     * OR to none").
     *
     * Keyed PER RESOURCE, not by filter name: `offerings` declares a `termId`
     * filter that IS a plain column, so a name-keyed rule would silently rewrite
     * it into a relation query against a relation offerings does not have.
     */
    relationalFilters?: Record<string, (value: never) => Record<string, unknown>>;
}

/**
 * Shared by the constraint resource's create refinement and its `beforeUpdate`.
 *
 * The two rules live in `shared/constraintTypes.ts` because the rule builder
 * enforces them too; this only adapts the result to zod's issue shape, keeping
 * the error on the offending FIELD so the form highlights the right control
 * rather than showing a form-level message.
 */
function constraintShapeRefinement(
    // `type` is required by the create schema (`z.string().min(1)`), so it is
    // always present here — unlike on the update path, which has no `type` at
    // all and reads the stored one instead.
    value: {
        type: string;
        severity?: string | null;
        weight?: number | null;
        params?: Record<string, unknown> | null;
        scopes?: { kindId: string }[] | null;
        members?: { offeringId: string }[] | null;
    },
    ctx: z.RefinementCtx,
): void {
    for (const problem of validateConstraintShape({
        ...value,
        scopeCount: value.scopes?.length,
        // Coalesced to 0, unlike the update path: a brand-new row has no
        // existing members to leave alone by omitting the field, so "not
        // sent" here means exactly what it says.
        memberCount: value.members?.length ?? 0,
    })) {
        /*
         * A parameter's issue is reported at the PARAMETER's key, not at
         * `params`. `params` is one `custom: true` field the rule builder
         * renders as many controls and never displays an error for, so
         * `path: ['params']` would set `fieldErrors.params` on nothing —
         * `applyError` would find a registered field, skip its orphan banner,
         * and leave a failed save with no visible cause. An unregistered key
         * takes the orphan path and names the parameter in the banner instead.
         */
        ctx.addIssue({
            code: 'custom',
            path: [problem.paramKey ?? problem.field],
            message: problem.message,
        });
    }
}

/**
 * The same two rules on the update path, which cannot be a zod refinement.
 *
 * `type` is absent from the update schema entirely — verified: a PATCH carrying
 * one returns 200 and leaves the stored type unchanged, because zod strips
 * unknown keys. So the STORED type is authoritative here and has to be read,
 * which a synchronous refinement cannot do.
 *
 * Only the fields present in the patch are passed on, which is what keeps a
 * legacy bad row editable — see the note on `validateConstraintShape`.
 */
async function constraintBeforeUpdate(ctx: {
    tx: Tx;
    tenantId: string;
    id: string;
    patch: Record<string, unknown>;
}): Promise<void> {
    /**
     * Emptying a variant's scopes would leave it an unscoped duplicate of a type
     * that already has a tenant-wide rule — the exact state `beforeCreate`
     * refuses. Guarding only the create path would mean the rule could be
     * reached in two requests instead of one.
     *
     * Only when the patch actually CLEARS them: a patch that does not mention
     * `scopes` leaves them alone, and one that sets a non-empty list is the
     * ordinary edit.
     */
    if (Array.isArray(ctx.patch.scopes) && ctx.patch.scopes.length === 0) {
        const row = await ctx.tx.constraint.findFirst({
            where: { id: ctx.id, tenantId: ctx.tenantId },
            select: { type: true, isDefault: true },
        });

        if (row && !row.isDefault) {
            const existingDefault = await ctx.tx.constraint.findFirst({
                where: { tenantId: ctx.tenantId, type: row.type, isDefault: true },
                select: { name: true },
            });

            if (existingDefault) {
                throw createError({
                    statusCode: 422,
                    statusMessage: `Removing every kind would make this a second tenant-wide `
                        + `'${row.type}' rule alongside "${existingDefault.name}". `
                        + 'Keep at least one kind, or delete this rule instead.',
                    data: { field: 'scopes', type: row.type },
                });
            }
        }
    }

    const touchesSeverity = 'severity' in ctx.patch;
    const touchesWeight = 'weight' in ctx.patch;
    const touchesParams = 'params' in ctx.patch;
    const touchesMembers = Array.isArray(ctx.patch.members);

    // Nothing this guard is about is being changed, so there is nothing to say.
    // Renaming or disabling a row must never be blocked by the shape of a value
    // the caller is not touching.
    if (!touchesSeverity && !touchesWeight && !touchesParams && !touchesMembers) {
        return;
    }

    const existing = await ctx.tx.constraint.findFirst({
        where: { id: ctx.id, tenantId: ctx.tenantId },
        select: { type: true },
    });

    // Missing or another tenant's row: say nothing and let the update itself
    // report it, so this guard cannot become a way to probe which ids exist.
    if (!existing) {
        return;
    }

    const problems: ConstraintShapeProblem[] = validateConstraintShape({
        type: existing.type,
        // Only when the patch actually carries scopes. `undefined` means "not
        // touched", which must not be read as "cleared to zero".
        ...(Array.isArray(ctx.patch.scopes)
            ? { scopeCount: (ctx.patch.scopes as unknown[]).length }
            : {}),
        ...(touchesSeverity ? { severity: ctx.patch.severity as string | null } : {}),
        ...(touchesWeight ? { weight: ctx.patch.weight as number | null } : {}),
        ...(touchesParams
            ? { params: ctx.patch.params as Record<string, unknown> | null }
            : {}),
        ...(touchesMembers
            ? { memberCount: (ctx.patch.members as unknown[]).length }
            : {}),
    });

    if (problems.length) {
        /**
         * Thrown in the ZOD ISSUE shape, not as a plain message, so the client
         * attaches it to the offending FIELD.
         *
         * `entityForm.applyError` maps `issue.path[0]` onto `fieldErrors`, and
         * falls back to a form-level banner for anything it cannot place. A
         * bespoke `{ fieldErrors }` payload would take that fallback — so the
         * identical mistake would highlight the weight input on create and
         * produce an unattached sentence on update. `extractIssues` reads
         * `data.issues`, which is what this fills.
         */
        throw createError({
            statusCode: 400,
            statusMessage: problems.map((p) => p.message).join(' '),
            data: {
                issues: problems.map((p) => ({
                    code: 'custom',
                    // The parameter's own key, for the reason
                    // `constraintShapeRefinement` documents: an issue placed on
                    // `params` is an issue placed on a control that shows none.
                    path: [p.paramKey ?? p.field],
                    message: p.message,
                })),
            },
        });
    }
}

/**
 * A calendar period must fall inside its Term — a REFUSAL, not a warning.
 *
 * A period entirely outside the term classifies NO week: the row exists, reads
 * back, appears in the list and means nothing. That is what "guards must fail
 * loudly" exists for, and the same shape as the bug that made this feature
 * necessary.
 *
 * A PARTIAL overlap is allowed: an exam week spilling into the next month is
 * ordinary and clipping is the natural reading. Overlaps BETWEEN periods are not
 * checked at all — the precedence rule ("EXAM if any exam period touches the week,
 * else whole-week BREAK, else HOLIDAY") only has meaning because they can overlap.
 */
async function assertPeriodWithinTerm(
    tx: Tx,
    tenantId: string,
    termId: string,
    startDate: Date,
    endDate: Date,
): Promise<void> {
    const term = await tx.term.findFirst({
        where: { id: termId, tenantId },
        select: { name: true, startDate: true, endDate: true },
    });

    // Absent or another tenant's: say nothing, and let the insert's foreign key
    // report it. This guard must not become a way to probe which ids exist.
    if (!term) {
        return;
    }

    if (endDate < term.startDate || startDate > term.endDate) {
        const iso = (d: Date) => d.toISOString().slice(0, 10);

        throw createError({
            statusCode: 400,
            statusMessage: `This period (${iso(startDate)} to ${iso(endDate)}) falls entirely outside `
                + `'${term.name}' (${iso(term.startDate)} to ${iso(term.endDate)}), so it would `
                + 'classify no week and have no effect. Move it inside the term.',
            data: {
                issues: [{ code: 'custom', path: ['startDate'], message: 'Outside the term\u2019s date range.' }],
            },
        });
    }
}

async function calendarPeriodBeforeCreate(ctx: {
    tx: Tx;
    tenantId: string;
    data: Record<string, unknown>;
}): Promise<void> {
    await assertPeriodWithinTerm(
        ctx.tx,
        ctx.tenantId,
        ctx.data.termId as string,
        ctx.data.startDate as Date,
        ctx.data.endDate as Date,
    );
}

/**
 * On update the MERGED range is checked, not just the patched field — unlike
 * the constraint guard, which validates only what the patch touches.
 *
 * The difference is that these two columns describe ONE fact between them.
 * Moving only `endDate` changes the range as a whole, so validating it in
 * isolation would accept a patch that makes the row inert. There is also no
 * trap to avoid here: an existing out-of-range row can always be repaired,
 * because any patch that brings the range back inside the term passes.
 */
async function calendarPeriodBeforeUpdate(ctx: {
    tx: Tx;
    tenantId: string;
    id: string;
    patch: Record<string, unknown>;
}): Promise<void> {
    if (!('startDate' in ctx.patch) && !('endDate' in ctx.patch)) {
        return;
    }

    const existing = await ctx.tx.calendarPeriod.findFirst({
        where: { id: ctx.id, tenantId: ctx.tenantId },
        select: { termId: true, startDate: true, endDate: true },
    });

    if (!existing) {
        return;
    }

    await assertPeriodWithinTerm(
        ctx.tx,
        ctx.tenantId,
        existing.termId,
        (ctx.patch.startDate as Date | undefined) ?? existing.startDate,
        (ctx.patch.endDate as Date | undefined) ?? existing.endDate,
    );
}

const id = z.string().min(1);
const optionalId = z.string().min(1).nullish();

/**
 * One permission key, narrowed to the catalogue at the write boundary.
 *
 * `z.custom` rather than `z.string().refine(...)` so the parsed value is typed
 * `PermissionKey` instead of `string` — the point of the union being real. An
 * unknown key is a 400 naming the field, not a foreign-key violation surfacing
 * as a 409 that says nothing about which key was wrong.
 */
const permissionKeySchema = z.custom<PermissionKey>(isPermissionKey, {
    message: 'Not in the permission catalogue (shared/permissions.ts). Permissions are code, not data.',
});

/**
 * The submitted keys exist as ROWS, not merely in the code.
 *
 * A distinct check from the schema above, and `create:role` makes the same
 * distinction for the same reason: the code can be ahead of the database, since
 * the catalogue is SEEDED rather than migrated. Without this the failure is an
 * opaque foreign-key violation on `permission_key`; with it, the answer names
 * the keys and the command that fixes them.
 *
 * Reads the whole table — a few dozen rows, only on writes — rather than a
 * query per key.
 */
async function assertPermissionsSeeded(tx: Tx, submitted: unknown): Promise<void> {
    if (!Array.isArray(submitted) || submitted.length === 0) {
        return;
    }

    const requested = submitted
        .map((row) => (row as { permissionKey?: unknown }).permissionKey)
        .filter((key): key is PermissionKey => isPermissionKey(key));

    const seeded = new Set((await tx.permission.findMany({ select: { key: true } })).map((row) => row.key));
    const missing = requested.filter((key) => !seeded.has(key));

    if (missing.length) {
        throw createError({
            statusCode: 422,
            statusMessage: `${missing.length} permission(s) exist in the code but not in the database `
                + `(${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ' …' : ''}). `
                + 'The catalogue is seeded, not migrated — run `bun run db-seed`.',
            data: { field: 'permissions' },
        });
    }
}

export const RESOURCES: Record<string, ResourceConfig> = {
    persons: {
        model: 'person',
        /**
         * A Person holding a login cannot simply be deleted.
         *
         * `account_person.person_id` is ON DELETE CASCADE, so the database would
         * accept this happily and leave the Account behind with no identity in
         * any tenant: invisible to every list, unreachable by every reset route,
         * and still holding a password that works. Not a warning — a state with
         * no owner is not something to mention, it is something to prevent, which
         * is the same call `sessionsOutsideGrid` makes for a narrowing TimeGrid.
         *
         * 409 naming the address, and the two ways forward, because the admin
         * hitting this has a real intention and "no" alone would send them to the
         * database.
         */
        async beforeDelete({ tx, tenantId, id }) {
            /*
             * Reached THROUGH `person`, not by `accountPerson.findUnique({
             * personId })`. `account_person` has no RLS, so asking it directly
             * would answer for another tenant's Person too — turning a
             * cross-tenant id from a flat 404 into a 409 that names somebody
             * else's login. A row that is not this tenant's simply falls through
             * here and the delete reports 404, as it always did.
             */
            const person = await tx.person.findFirst({
                where: { id, tenantId },
                select: { accountLink: { select: { account: { select: { email: true } } } } },
            });

            const link = person?.accountLink;

            if (link) {
                throw createError({
                    statusCode: 409,
                    statusMessage: `This person holds the login ${link.account.email}. Delete that `
                        + 'login, or attach it to somebody else, before deleting the person — '
                        + 'otherwise the password keeps working with nobody able to see or revoke it.',
                });
            }
        },
        create: z.object({
            externalRef: z.string().nullish(),
            givenName: z.string().min(1),
            familyName: z.string().min(1),
            email: z.string().email().nullish(),
            timezone: z.string().nullish(),
            isActive: z.boolean().optional(),
        }),
        update: z.object({
            externalRef: z.string().nullish(),
            givenName: z.string().min(1).optional(),
            familyName: z.string().min(1).optional(),
            email: z.string().email().nullish(),
            timezone: z.string().nullish(),
            isActive: z.boolean().optional(),
        }),
        filters: z.object({
            isActive: z.coerce.boolean().optional(),
            email: z.string().optional(),
        }),
        orderBy: { familyName: 'asc' },
        searchFields: ['givenName', 'familyName', 'email', 'externalRef'],
    },

    roles: {
        model: 'role',
        // Provisioning owns `is_system`; the UI has always hidden delete for
        // such a row and the API has always allowed it. Same rule, now enforced
        // where it is actually decided.
        systemFlag: 'isSystem',
        create: z.object({
            key: z.string().min(1),
            name: z.string().min(1),
            description: z.string().nullish(),
        }),
        update: z.object({
            name: z.string().min(1).optional(),
            description: z.string().nullish(),
        }),
        filters: z.object({ key: z.string().optional() }),
        orderBy: { key: 'asc' },
        searchFields: ['key', 'name', 'description'],
    },

    groups: {
        model: 'group',
        // Scope travels with the row so a caller can tell "available everywhere"
        // from "available here" without a second request — the distinction the
        // whole fail-open rule turns on.
        include: { terms: true },
        create: z.object({
            parentGroupId: optionalId,
            name: z.string().min(1),
            description: z.string().nullish(),
            expectedSize: z.number().int().nonnegative().nullish(),
        }),
        update: z.object({
            // Reparenting is allowed; group_closure is rebuilt by the database
            // trigger from Step 3, never by this route.
            parentGroupId: optionalId,
            name: z.string().min(1).optional(),
            description: z.string().nullish(),
            expectedSize: z.number().int().nonnegative().nullish(),
        }),
        filters: z.object({
            parentGroupId: z.string().optional(),
            /** See `relationalFilters.termId` — scoped-or-universal, not equality. */
            termId: z.string().optional(),
        }),
        /**
         * SCOPED-OR-UNIVERSAL, and the second half is the whole design.
         *
         * `group_term` says which Terms a Group is available in, and NO ROW
         * MEANS EVERY TERM (fail-open). So filtering by Term must return the
         * Groups explicitly scoped to it AND the unscoped ones — a bare
         * `terms: { some: { termId } }` would hide every Group nobody has
         * scoped yet, which today is eight of ten and would make the picker
         * emptier the moment this shipped.
         *
         * `none: {}` rather than a count: it is the direct expression of
         * "carries no scope rows at all", and reads as the rule it implements.
         */
        relationalFilters: {
            termId: (value: string) => ({
                OR: [
                    { terms: { some: { termId: value } } },
                    { terms: { none: {} } },
                ],
            }),
        },
        orderBy: { name: 'asc' },
        searchFields: ['name', 'description'],
    },

    rooms: {
        model: 'room',
        federationOwnable: true,
        create: z.object({
            code: z.string().min(1),
            name: z.string().min(1),
            capacity: z.number().int().nonnegative().optional(),
            location: z.string().nullish(),
            ranking: z.number().int().optional(),
            isVirtual: z.boolean().optional(),
            isActive: z.boolean().optional(),
        }),
        update: z.object({
            code: z.string().min(1).optional(),
            name: z.string().min(1).optional(),
            capacity: z.number().int().nonnegative().optional(),
            location: z.string().nullish(),
            ranking: z.number().int().optional(),
            isVirtual: z.boolean().optional(),
            isActive: z.boolean().optional(),
        }),
        filters: z.object({
            isVirtual: z.coerce.boolean().optional(),
            isActive: z.coerce.boolean().optional(),
            minCapacity: z.coerce.number().int().optional(),
        }),
        // A range, not an equality. Was special-cased by name in the list route;
        // declared here now so the route stays generic.
        relationalFilters: {
            minCapacity: (value: number) => ({ capacity: { gte: value } }),
        },
        orderBy: { code: 'asc' },
        searchFields: ['code', 'name', 'location'],
    },

    equipment: {
        model: 'equipment',
        federationOwnable: true,
        create: z.object({
            key: z.string().min(1),
            name: z.string().min(1),
            description: z.string().nullish(),
        }),
        update: z.object({
            name: z.string().min(1).optional(),
            description: z.string().nullish(),
        }),
        filters: z.object({ key: z.string().optional() }),
        orderBy: { key: 'asc' },
        searchFields: ['key', 'name', 'description'],
    },

    offerings: {
        model: 'offering',
        federationOwnable: true,
        create: z.object({
            termId: id,
            kindId: id,
            code: z.string().nullish(),
            title: z.string().min(1),
            // Free-form, and NULL means "inherit the Session kind's colour"
            // rather than "no colour" — the resolution order in
            // `shared/sessionColor.ts` is what gives that null a meaning.
            color: z.string().nullish(),
            frequency: z.number().int().min(1).optional(),
            durationBlocks: z.number().int().min(1).optional(),
            /*
             * '' IS NULL HERE. The form's blank option means UNCLASSIFIED, and a
             * `<select>` has no way to send absent — it sends the empty string.
             * Left unmapped, zod would reject it and the one choice that means
             * "I have not decided" would be the only one that could not be
             * saved.
             */
            schedulingPattern: z.preprocess(
                (value) => (value === '' ? null : value),
                z.enum(['DISTRIBUTED', 'BLOCK']).nullish(),
            ),
            requiredRoleId: optionalId,
            requiredCapacity: z.number().int().nonnegative().nullish(),
            /*
             * BOUNDED AT BOTH ENDS, and the upper bound is not a preference.
             * Above `MAX_ROOMS_PER_SESSION` the solver REFUSES the whole input
             * rather than truncating, so a 5 saved here is a scheduling outage
             * for the tenant, surfacing later as a failed run naming an
             * Offering somebody edited weeks ago. Rejected at the write, where
             * the person who typed it is still looking at it.
             *
             * The database CHECK says the same thing again — this is the
             * friendly refusal, that one is the guarantee.
             */
            requiredRoomCount: z.number().int().min(1).max(MAX_ROOMS_PER_SESSION).optional(),
            allowOnline: z.boolean().optional(),
            isActive: z.boolean().optional(),
            notes: z.string().nullish(),
        }),
        update: z.object({
            kindId: id.optional(),
            code: z.string().nullish(),
            title: z.string().min(1).optional(),
            color: z.string().nullish(),
            frequency: z.number().int().min(1).optional(),
            durationBlocks: z.number().int().min(1).optional(),
            /*
             * '' IS NULL HERE. The form's blank option means UNCLASSIFIED, and a
             * `<select>` has no way to send absent — it sends the empty string.
             * Left unmapped, zod would reject it and the one choice that means
             * "I have not decided" would be the only one that could not be
             * saved.
             */
            schedulingPattern: z.preprocess(
                (value) => (value === '' ? null : value),
                z.enum(['DISTRIBUTED', 'BLOCK']).nullish(),
            ),
            requiredRoleId: optionalId,
            requiredCapacity: z.number().int().nonnegative().nullish(),
            /*
             * BOUNDED AT BOTH ENDS, and the upper bound is not a preference.
             * Above `MAX_ROOMS_PER_SESSION` the solver REFUSES the whole input
             * rather than truncating, so a 5 saved here is a scheduling outage
             * for the tenant, surfacing later as a failed run naming an
             * Offering somebody edited weeks ago. Rejected at the write, where
             * the person who typed it is still looking at it.
             *
             * The database CHECK says the same thing again — this is the
             * friendly refusal, that one is the guarantee.
             */
            requiredRoomCount: z.number().int().min(1).max(MAX_ROOMS_PER_SESSION).optional(),
            allowOnline: z.boolean().optional(),
            isActive: z.boolean().optional(),
            notes: z.string().nullish(),
        }),
        filters: z.object({
            termId: z.string().optional(),
            kindId: z.string().optional(),
            isActive: z.coerce.boolean().optional(),
        }),
        orderBy: { title: 'asc' },
        searchFields: ['title', 'code', 'notes'],
    },

    'time-grids': {
        model: 'timeGrid',
        // Backed by the partial unique index time_grid_one_default_per_tenant
        // (migration 20260814120000). The index is the guarantee; this is what
        // makes promoting a grid an ordinary action rather than a 409.
        exclusiveFlag: 'isDefault',
        include: { breaks: true },
        childKeys: ['breaks'],
        async writeChildren({ tx, tenantId, id, children }) {
            const rows = (children.breaks ?? []) as {
                afterBlockIndex: number; durationMinutes: number; label: string; dayOfWeek?: number | null;
            }[];

            // Replaced wholesale, like every other set in this codebase: the
            // submitted list is the authority, and diffing would be three code
            // paths where this is one.
            await tx.timeGridBreak.deleteMany({ where: { timeGridId: id, tenantId } });

            if (rows.length) {
                await tx.timeGridBreak.createMany({
                    data: rows.map((b) => ({
                        timeGridId: id,
                        tenantId,
                        afterBlockIndex: b.afterBlockIndex,
                        durationMinutes: b.durationMinutes,
                        label: b.label,
                        dayOfWeek: b.dayOfWeek ?? null,
                    })),
                });
            }
        },
        create: z.object({
            name: z.string().min(1),
            blockLengthMinutes: z.number().int().min(1),
            blocksPerDay: z.number().int().min(1),
            activeDays: z.array(z.number().int().min(1).max(7)).min(1),
            startHour: z.number().int().min(0).max(23).optional(),
            startMinute: z.number().int().min(0).max(59).optional(),
            breakMinutes: z.number().int().min(0).optional(),
            breaks: z.array(z.object({
                afterBlockIndex: z.number().int().min(0),
                durationMinutes: z.number().int().min(1),
                label: z.string().min(1),
                dayOfWeek: z.number().int().min(1).max(7).nullish(),
            })).optional(),
            isDefault: z.boolean().optional(),
        }),
        update: z.object({
            name: z.string().min(1).optional(),
            blockLengthMinutes: z.number().int().min(1).optional(),
            blocksPerDay: z.number().int().min(1).optional(),
            activeDays: z.array(z.number().int().min(1).max(7)).min(1).optional(),
            startHour: z.number().int().min(0).max(23).optional(),
            startMinute: z.number().int().min(0).max(59).optional(),
            breakMinutes: z.number().int().min(0).optional(),
            breaks: z.array(z.object({
                afterBlockIndex: z.number().int().min(0),
                durationMinutes: z.number().int().min(1),
                label: z.string().min(1),
                dayOfWeek: z.number().int().min(1).max(7).nullish(),
            })).optional(),
            isDefault: z.boolean().optional(),
        }),
        filters: z.object({ isDefault: z.coerce.boolean().optional() }),
        orderBy: { name: 'asc' },
        searchFields: ['name'],
        /**
         * Narrowing a grid must not orphan Sessions that already sit in it.
         *
         * Only `blocksPerDay` and `activeDays` define the index space, so only
         * those two are checked — see `fitsGrid`. Widening is always safe, and
         * so is renaming or re-timing, which is why the effective bounds below
         * are computed by MERGING the patch over the stored row rather than
         * running whenever either key merely appears.
         */
        async beforeUpdate({ tx, tenantId, id, patch }) {
            const touchesIndexSpace = 'blocksPerDay' in patch || 'activeDays' in patch;

            if (!touchesIndexSpace) {
                return;
            }

            const current = await tx.timeGrid.findFirst({
                where: { id, tenantId },
                select: { blocksPerDay: true, activeDays: true },
            });

            if (!current) {
                // Missing or another tenant's. The update itself reports that;
                // refusing here would turn a 404 into a confusing 409.
                return;
            }

            const next = {
                blocksPerDay: (patch.blocksPerDay as number | undefined) ?? current.blocksPerDay,
                activeDays: (patch.activeDays as number[] | undefined) ?? current.activeDays,
            };

            // A pure widening cannot orphan anything, so it skips the query.
            const widensOnly = next.blocksPerDay >= current.blocksPerDay
                && current.activeDays.every((d) => next.activeDays.includes(d));

            if (widensOnly) {
                return;
            }

            const { total, named } = await sessionsOutsideGrid(tx, id, next);

            if (total > 0) {
                throw createError({
                    statusCode: 409,
                    statusMessage: describeOrphans(total, named),
                    data: { sessionIds: named.map((s) => s.id), total },
                });
            }

            /**
             * Break overrides that no longer name a real position are removed,
             * not refused. The asymmetry with Sessions above is the whole
             * distinction: an orphaned Session is DATA that resolves to no time
             * and breaks the solver, so the edit is refused; an orphaned break is
             * CONFIGURATION nothing references or renders.
             *
             * Same transaction as the update, so a failed shrink deletes nothing.
             * Reported rather than silent: quietly discarding a tenant's named
             * lunch is exactly the failure mode a guard must not have.
             */
            const dangling = await tx.timeGridBreak.findMany({
                where: {
                    timeGridId: id,
                    tenantId,
                    OR: [
                        { afterBlockIndex: { gte: next.blocksPerDay } },
                        { dayOfWeek: { notIn: next.activeDays } },
                    ],
                },
                select: { id: true, label: true, afterBlockIndex: true, dayOfWeek: true },
            });

            if (dangling.length) {
                await tx.timeGridBreak.deleteMany({ where: { id: { in: dangling.map((b) => b.id) } } });

                console.warn('[time-grid] dropped %d break override(s) left dangling by a shrink: %s',
                    dangling.length,
                    dangling.map((b) => `${b.label} (after block ${b.afterBlockIndex}`
                        + `${b.dayOfWeek ? `, day ${b.dayOfWeek}` : ''})`).join('; '));
            }
        },
    },

    terms: {
        model: 'term',
        create: z.object({
            name: z.string().min(1),
            startDate: z.coerce.date(),
            endDate: z.coerce.date(),
            timeGridId: optionalId,
        }),
        update: z.object({
            name: z.string().min(1).optional(),
            startDate: z.coerce.date().optional(),
            endDate: z.coerce.date().optional(),
            timeGridId: optionalId,
        }),
        filters: z.object({}),
        orderBy: { startDate: 'desc' },
        searchFields: ['name'],
    },

    /**
     * Holidays, break weeks and exam periods, ON THE GENERIC SCAFFOLD: the row is
     * four scalars with none of what earned the bespoke editors their slots — no
     * hierarchy, no arithmetic a form field cannot express, no fields constraining
     * each other. Only the week PREVIEW is bespoke, as one `custom: true` field.
     *
     * The table, model, RLS policy and wire had been in place since the initial
     * schema, but nothing could WRITE a row — so `minimize_exam_week_sessions`
     * reported zero violations while looking like it worked, and raising its
     * weight from 5 to 1000 multiplied zero by two hundred.
     */
    'calendar-periods': {
        model: 'calendarPeriod',
        create: z.object({
            termId: id,
            kind: z.enum(['HOLIDAY', 'BREAK', 'EXAM']),
            name: z.string().min(1),
            startDate: z.coerce.date(),
            endDate: z.coerce.date(),
        }),
        update: z.object({
            // `termId` is deliberately absent: moving a period to another Term
            // is creating a different period, and allowing it would let a row
            // land outside the range `beforeCreate` checked it against.
            kind: z.enum(['HOLIDAY', 'BREAK', 'EXAM']).optional(),
            name: z.string().min(1).optional(),
            startDate: z.coerce.date().optional(),
            endDate: z.coerce.date().optional(),
        }),
        filters: z.object({
            termId: z.string().optional(),
            kind: z.enum(['HOLIDAY', 'BREAK', 'EXAM']).optional(),
        }),
        orderBy: { startDate: 'asc' },
        searchFields: ['name'],
        beforeCreate: calendarPeriodBeforeCreate,
        beforeUpdate: calendarPeriodBeforeUpdate,
    },

    constraints: {
        model: 'constraint',
        // `include` here is boolean-only (`ResourceConfig.include`), so
        // ordering by `position` happens where `relationMembers` is actually
        // consumed (the picker UI, the solver-input assembly) rather than here.
        include: { scopes: true, relationMembers: true },
        /**
         * Scopes travel WITH the constraint rather than as a relation.
         *
         * `ManageRelationsPanel` says it plainly: "Relations need an id to hang
         * off, so on the create page there is nothing to edit yet." A scope
         * added after the row exists is a scope the row spent a moment without —
         * and for a non-default constraint that moment is an UNSCOPED DUPLICATE
         * of a type that already has a default, applying tenant-wide until the
         * second request lands. `beforeCreate` below refuses exactly that state,
         * so the scope has to arrive in the same payload.
         *
         * Same mechanism `time-grids` already uses for `breaks`, and written in
         * one transaction for the same reason.
         */
        childKeys: ['scopes', 'members'],
        async writeChildren({ tx, tenantId, id, children }) {
            const rows = (children.scopes ?? []) as { kindId: string }[];

            // Replaced wholesale, like every other set here: the submitted list
            // is the authority.
            await tx.constraintScope.deleteMany({ where: { constraintId: id, tenantId } });

            if (rows.length) {
                await tx.constraintScope.createMany({
                    data: rows.map((scope) => ({
                        constraintId: id,
                        tenantId,
                        kindId: scope.kindId,
                        // Offering scoping is deliberately not exposed here —
                        // see the schema note below.
                        offeringId: null,
                    })),
                });
            }

            /*
             * A RELATION TYPE'S ORDERED OPERANDS (ADR-0028 in calendry-solver).
             * `position` comes from array order, not a field the client sends —
             * the array IS the order, the same way the submitted list IS the
             * authority for scopes above.
             */
            const members = (children.members ?? []) as { offeringId: string }[];

            await tx.constraintRelationMember.deleteMany({ where: { constraintId: id, tenantId } });

            if (members.length) {
                await tx.constraintRelationMember.createMany({
                    data: members.map((member, position) => ({
                        constraintId: id,
                        tenantId,
                        offeringId: member.offeringId,
                        position,
                    })),
                });
            }
        },
        /**
         * A NON-DEFAULT constraint of a type that already has a default must name
         * at least one scope. Without it, "Add scoped variant" produces a second
         * tenant-wide rule of the same type — the duplicate-constraint defect this
         * project already fixed once, reintroduced through a button promising the
         * opposite.
         *
         * Not expressible as a CHECK ("has at least one row in another table"),
         * and the partial unique index only governs how many DEFAULTS exist.
         * Excluding such types from the picker instead is unworkable: every live
         * catalogue type has a default row, so the picker would be empty.
         */
        async beforeCreate({ tx, tenantId, data, children }) {
            const type = data.type as string | undefined;
            const scopes = (children.scopes ?? []) as unknown[];

            /*
             * A DERIVED TYPE HAS NO VARIANTS. Its scope comes from the session
             * kinds' own classification, so a second row of the same type would
             * be a second rule over exactly the same kinds — the duplicate this
             * guard exists to prevent, and one the usual escape ("name a scope")
             * cannot resolve, because naming a scope is refused for these.
             */
            const derived = type ? findConstraintType(type)?.appliesToKindType : undefined;

            if (type && derived) {
                const existing = await tx.constraint.findFirst({
                    where: { tenantId, type },
                    select: { id: true, name: true },
                });

                if (existing) {
                    throw createError({
                        statusCode: 422,
                        statusMessage: `'${type}' already exists as "${existing.name}" and cannot have `
                            + `a second rule: it applies to every session kind whose type is ${derived}, `
                            + 'so another row would cover exactly the same sessions. Edit that rule, or '
                            + `change which kinds are ${derived}.`,
                        data: { field: 'type', type, existingConstraintId: existing.id },
                    });
                }

                return;
            }

            if (!type || scopes.length > 0) {
                return;
            }

            const existingDefault = await tx.constraint.findFirst({
                where: { tenantId, type, isDefault: true },
                select: { id: true, name: true },
            });

            if (existingDefault) {
                throw createError({
                    statusCode: 422,
                    statusMessage: `'${type}' already has a tenant-wide rule ("${existingDefault.name}"). `
                        + 'An additional rule of the same type must name at least one session kind, '
                        + 'or it would silently duplicate that one.',
                    data: { field: 'scopes', type, defaultConstraintId: existingDefault.id },
                });
            }
        },
        create: z.object({
            type: z.string().min(1),
            name: z.string().min(1),
            severity: z.enum(['HARD', 'SOFT']),
            /**
             * The DB CHECK enforces the HARD/SOFT ⇄ weight pairing; this only
             * shapes the input.
             *
             * NO CEILING, BY DESIGN. A weight has no absolute meaning: the solver
             * derives `hard_penalty = sum(soft weights) * placements + 1`, so only
             * RATIOS matter and raising one weight raises the penalty in the same
             * step — magnitude can never let a soft rule overrule a hard one. "10"
             * is neither safer nor more correct than "10000".
             *
             * NO LOWER BOUND HERE EITHER, but not because there isn't one:
             * `superRefine(constraintShapeRefinement)` below refuses a negative
             * weight against the catalogue, because a negative one SUBTRACTS from
             * `total_weight` and erodes the penalty that keeps hard constraints
             * dominant for every rule in the tenant. Zod could express `min(0)`,
             * and deliberately does not — the bound, the severity check and the
             * parameter checks are one function shared with the update path and
             * the rule builder, and splitting one of the three back out here is
             * how they start disagreeing.
             */
            weight: z.number().int().nullish(),
            params: z.record(z.string(), z.unknown()).optional(),
            isEnabled: z.boolean().optional(),
            /**
             * KIND SCOPES ONLY, and that is a UI-honesty decision rather than a
             * schema limit.
             *
             * `constraint_scope` can name an Offering, and the relation endpoint
             * still accepts one. But `assembleSolverInput` SKIPS a constraint
             * scoped to offerings entirely — `ConstraintConfig` carries
             * `applies_to_kinds` only, and sending it unscoped would widen the
             * rule rather than narrow it. Offering-scoping through this form
             * would therefore be a control whose main effect is to switch the
             * rule off in the solve, which is the silent-no-op class this
             * project keeps designing against.
             *
             * Kind scopes DO reach the solver, as `appliesToKinds`.
             */
            /*
             * NULL = every grid. For rules stated in units the grid defines —
             * a gap, a block cap, a daily span — which two grids cannot mean
             * the same numbers by.
             */
            timeGridId: optionalId,
            /*
             * `.nullish()`, NOT `.optional()` — `useEntityForm.save()` sends
             * `null` for a `custom` field nothing touched (`toPayloadValue`'s
             * fallback is `value ?? null`), not an absent key. `.optional()`
             * tolerates the key being missing but rejects an explicit `null`,
             * so the most ordinary create — no scope checkbox touched — failed
             * "Validation Error" on `scopes`. Same bug, same fix, as
             * `server/api/screens/index.post.ts`'s `roomIds`.
             */
            scopes: z.array(z.object({ kindId: z.string().min(1) })).nullish(),
            /**
             * A RELATION TYPE'S OPERANDS (ADR-0028 in calendry-solver) —
             * `ConstraintRelationMember`, never `ConstraintScope`: these
             * Offerings are what the rule is ABOUT, not a filter narrowing it.
             * Order is the array's own order; see `writeChildren`.
             */
            // Same `.nullish()` reasoning as `scopes` just above.
            members: z.array(z.object({ offeringId: z.string().min(1) })).nullish(),
        }).superRefine(constraintShapeRefinement),
        update: z.object({
            name: z.string().min(1).optional(),
            severity: z.enum(['HARD', 'SOFT']).optional(),
            /** Unbounded above; bounded below by the shared guard — see `create`. */
            weight: z.number().int().nullish(),
            params: z.record(z.string(), z.unknown()).optional(),
            isEnabled: z.boolean().optional(),
            /** Editable after creation too; same kind-only reasoning as create. */
            /*
             * NULL = every grid. For rules stated in units the grid defines —
             * a gap, a block cap, a daily span — which two grids cannot mean
             * the same numbers by.
             */
            timeGridId: optionalId,
            /*
             * `.nullish()`, NOT `.optional()` — `useEntityForm.save()` sends
             * `null` for a `custom` field nothing touched (`toPayloadValue`'s
             * fallback is `value ?? null`), not an absent key. `.optional()`
             * tolerates the key being missing but rejects an explicit `null`,
             * so the most ordinary create — no scope checkbox touched — failed
             * "Validation Error" on `scopes`. Same bug, same fix, as
             * `server/api/screens/index.post.ts`'s `roomIds`.
             */
            scopes: z.array(z.object({ kindId: z.string().min(1) })).nullish(),
            /** Editable after creation too; same operands-not-scope reasoning as create. */
            // Same `.nullish()` reasoning as `scopes` just above.
            members: z.array(z.object({ offeringId: z.string().min(1) })).nullish(),
        }),
        beforeUpdate: constraintBeforeUpdate,
        filters: z.object({
            type: z.string().optional(),
            severity: z.enum(['HARD', 'SOFT']).optional(),
            isEnabled: z.coerce.boolean().optional(),
        }),
        orderBy: { type: 'asc' },
        searchFields: ['type', 'name'],
    },

    'session-kinds': {
        model: 'sessionKind',
        create: z.object({
            key: z.string().min(1),
            name: z.string().min(1),
            // Free-form so a tenant is not boxed into a palette we chose. The
            // schedule chip falls back to a neutral tint when this is null.
            color: z.string().nullish(),
            // Lets the API reject a Group-scoped constraint aimed at a kind that
            // carries no Groups (TAXONOMY.md §9.5).
            requiresGroup: z.boolean().optional(),
            /*
             * The FIXED classification behind the tenant's own `key`/`name`.
             * Rules that are only meaningful about one class of session derive
             * their scope from this — see `appliesToKindType`.
             */
            type: z.enum(SESSION_KIND_TYPES).optional(),
        }),
        update: z.object({
            name: z.string().min(1).optional(),
            color: z.string().nullish(),
            requiresGroup: z.boolean().optional(),
            type: z.enum(SESSION_KIND_TYPES).optional(),
        }),
        filters: z.object({ key: z.string().optional() }),
        orderBy: { key: 'asc' },
        searchFields: ['key', 'name'],
    },

    /**
     * AccessRole — a tenant-defined bundle of the FIXED permission catalogue
     * (TAXONOMY.md §4). Not the domain `Role`, which is scheduling vocabulary.
     *
     * An ordinary tenant-scoped table behind `tenant_isolation`; the only
     * unusual parts are the permissions (`access_role.manage`, not four CRUD
     * verbs — see RESOURCE_PERMISSIONS) and the grants, which are child rows.
     */
    'access-roles': {
        model: 'accessRole',
        /*
         * The grants travel WITH the role on read, because every screen that
         * shows a role shows what it holds. Bounded by construction: there are
         * a few dozen permissions and a handful of roles per tenant.
         */
        include: { permissions: true },
        /**
         * Permissions are CHILD ROWS, not a RELATION. `RELATIONS` is a picker over
         * existing ENTITIES and needs an API resource to fetch options from; there
         * is no `/api/permissions` and there must not be one, because the editor
         * renders from `shared/permissions.ts` so an unseeded permission is
         * REPORTED rather than silently missing.
         *
         * They also have to arrive in the same request as the row: a relation
         * saves separately, so "create then grant" would leave a window holding a
         * role that grants nothing. Same mechanism `time-grids` uses for `breaks`.
         */
        childKeys: ['permissions'],
        async writeChildren({ tx, tenantId, id, children }) {
            const rows = (children.permissions ?? []) as { permissionKey: PermissionKey }[];

            // Replaced wholesale, like every other set here: the submitted list
            // is the authority.
            await tx.accessRolePermission.deleteMany({ where: { accessRoleId: id, tenantId } });

            if (rows.length) {
                await tx.accessRolePermission.createMany({
                    data: rows.map((row) => ({
                        accessRoleId: id,
                        tenantId,
                        permissionKey: row.permissionKey,
                    })),
                    // A duplicate in the submitted set is a client mistake, not a
                    // reason to fail: the resulting SET is the same either way.
                    // This is also the exact shape that broke `provision:tenant`
                    // when the catalogue held one key twice.
                    skipDuplicates: true,
                });
            }
        },
        async beforeCreate({ tx, tenantId, data, children }) {
            await assertPermissionsSeeded(tx, children.permissions);

            /*
             * Fails loudly rather than upserting, and says which role it clashed
             * with. `@@unique([tenantId, key])` is the real guard and still
             * catches the race this check cannot; what this adds is a message
             * that names the incumbent instead of "Already exists."
             */
            const key = data.key as string | undefined;

            if (!key) {
                return;
            }

            const clash = await tx.accessRole.findFirst({
                where: { tenantId, key },
                select: { name: true },
            });

            if (clash) {
                throw createError({
                    statusCode: 409,
                    statusMessage: `An access role with the key '${key}' already exists in this tenant `
                        + `("${clash.name}"). This creates a role; it does not update one.`,
                    data: { field: 'key' },
                });
            }
        },
        async beforeUpdate({ tx, patch }) {
            await assertPermissionsSeeded(tx, patch.permissions);
        },
        /*
         * Editing a role's grants and deleting the role are two of the three
         * ways a tenant can strip its own last administrator; revoking the last
         * assignment is the third and lives on the relation. All three end in
         * the same function, measured after the write.
         */
        afterWrite: ({ tx, tenantId }) => assertTenantRetainsAdministrator(tx, tenantId),
        /*
         * `tenant-admin` is provisioning's own row and the one every tenant
         * starts with. Deleting it is the shortest path to a tenant that cannot
         * administer itself, and the UI hiding the button was never a guard.
         */
        systemFlag: 'isSystem',
        create: z.object({
            key: z.string().min(1),
            name: z.string().min(1),
            description: z.string().nullish(),
            /*
             * Required on create, and at least one. See `childKeys` above: this
             * is the CLI's rule ("a role holding nothing is a role that does
             * nothing") expressed where the API can enforce it too, rather than
             * only in the form — the divergence the constraint-shape work
             * already had to close once.
             *
             * `is_system` is deliberately absent from both schemas. Provisioning
             * owns it; a role that could declare itself undeletable through the
             * API would be a way to make a role nobody can remove.
             */
            permissions: z.array(z.object({ permissionKey: permissionKeySchema })).min(1),
        }),
        update: z.object({
            // `key` is createOnly: it is the stable identifier `create:account
            // --role <key>` and any import addresses the role by.
            name: z.string().min(1).optional(),
            description: z.string().nullish(),
            permissions: z.array(z.object({ permissionKey: permissionKeySchema })).min(1).optional(),
        }),
        filters: z.object({ key: z.string().optional() }),
        orderBy: { key: 'asc' },
        searchFields: ['key', 'name', 'description'],
    },
};

/**
 * Demotes every other row holding an exclusive flag, when the incoming body
 * sets it.
 *
 * Runs INSIDE the caller's transaction, immediately before the write, so the
 * moment where two rows hold the flag is never observable and a failed write
 * leaves nothing demoted.
 *
 * Only ever demotes — it never promotes, and it does nothing at all when the
 * body does not set the flag to true. Clearing the flag on the last remaining
 * default is therefore allowed: "no default" is a legitimate state (a Term can
 * always name its grid explicitly), and silently refusing to un-set it would be
 * this function inventing a rule the schema does not have.
 */
export async function demoteExclusiveSiblings(
    tx: Tx,
    config: ResourceConfig,
    tenantId: string,
    body: Record<string, unknown>,
    exceptId?: string,
): Promise<void> {
    const flag = config.exclusiveFlag;

    if (!flag || body[flag] !== true) {
        return;
    }

    await delegate(tx, config.model).updateMany({
        where: {
            tenantId,
            [flag]: true,
            ...(exceptId ? { NOT: { id: exceptId } } : {}),
        },
        data: { [flag]: false },
    });
}

export function getResource(name: string | undefined): ResourceConfig {
    const config = name ? RESOURCES[name] : undefined;

    if (!config) {
        throw createError({ statusCode: 404, statusMessage: `Unknown resource '${name}'.` });
    }

    return config;
}

/**
 * Prisma's delegates are a discriminated union that cannot be indexed by a
 * runtime string without losing all typing. The cast is contained here so the
 * rest of the codebase keeps its types.
 */
/** Splits a validated body into column values and child-row collections. */
export function splitChildren(
    config: ResourceConfig,
    body: Record<string, unknown>,
): { columns: Record<string, unknown>; children: Record<string, unknown[]> } {
    const childKeys = new Set(config.childKeys ?? []);
    const columns: Record<string, unknown> = {};
    const children: Record<string, unknown[]> = {};

    // Partitioned by rebuilding rather than by deleting keys: a dynamic
    // `delete` is both an eslint error here and a deoptimisation, and the
    // rebuild states the intent — these are columns, those are child rows.
    for (const [key, value] of Object.entries(body)) {
        if (childKeys.has(key)) {
            children[key] = (value as unknown[]) ?? [];
        } else {
            columns[key] = value;
        }
    }

    return { columns, children };
}

export function delegate(tx: Tx, model: string) {
    const d = (tx as unknown as Record<string, unknown>)[model];

    if (!d) {
        throw createError({ statusCode: 500, statusMessage: `No Prisma delegate '${model}'.` });
    }

    return d as {
        findMany: (args: unknown) => Promise<unknown[]>;
        count: (args: unknown) => Promise<number>;
        findFirst: (args: unknown) => Promise<unknown>;
        create: (args: unknown) => Promise<unknown>;
        update: (args: unknown) => Promise<unknown>;
        updateMany: (args: unknown) => Promise<{ count: number }>;
        deleteMany: (args: unknown) => Promise<{ count: number }>;
    };
}
