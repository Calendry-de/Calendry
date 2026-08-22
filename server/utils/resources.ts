import { z } from 'zod';
import type { Tx } from './tenantDb';
import { describeOrphans, sessionsOutsideGrid } from './gridBounds';
import { validateConstraintShape } from '../../shared/constraintTypes';
import type { ConstraintShapeProblem } from '../../shared/constraintTypes';

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
    }) => Promise<void>;
    beforeUpdate?: (ctx: {
        tx: Tx;
        tenantId: string;
        id: string;
        patch: Record<string, unknown>;
    }) => Promise<void>;
    /**
     * Declared filters that are NOT plain column equality.
     *
     * The list route spreads `filters` straight into `where`, which is right for
     * the common case and wrong for two: a range (`minCapacity` means
     * `capacity >= n`) and a relation (`groups?termId=` means "scoped to that
     * Term OR scoped to none"). Each entry removes its key from the equality
     * spread and contributes a clause to the AND list instead.
     *
     * Keyed PER RESOURCE rather than by filter name, which is the point: the
     * route previously special-cased `minCapacity` by name, and `termId` cannot
     * work that way — `offerings` declares a `termId` filter that IS a plain
     * column, so a name-keyed rule would silently rewrite it into a relation
     * query against a relation offerings does not have.
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
    value: { type: string; severity?: string | null; weight?: number | null },
    ctx: z.RefinementCtx,
): void {
    for (const problem of validateConstraintShape(value)) {
        ctx.addIssue({ code: 'custom', path: [problem.field], message: problem.message });
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
    const touchesSeverity = 'severity' in ctx.patch;
    const touchesWeight = 'weight' in ctx.patch;

    // Nothing this guard is about is being changed, so there is nothing to say.
    // Renaming or disabling a row must never be blocked by the shape of a value
    // the caller is not touching.
    if (!touchesSeverity && !touchesWeight) {
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
        ...(touchesSeverity ? { severity: ctx.patch.severity as string | null } : {}),
        ...(touchesWeight ? { weight: ctx.patch.weight as number | null } : {}),
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
                    path: [p.field],
                    message: p.message,
                })),
            },
        });
    }
}

/**
 * A calendar period must fall inside its Term.
 *
 * WHY THIS IS A REFUSAL AND NOT A WARNING
 *
 * A period entirely outside `[term.startDate, term.endDate]` classifies NO
 * week: every overlap test in `classifyWeeks` fails, so the row exists, reads
 * back correctly, appears in the list, and means nothing. That is precisely the
 * failure mode CLAUDE.md's "guards must fail loudly or match exactly" rule
 * exists for — and it is the same shape as the bug that made this whole feature
 * necessary, where an empty `calendar_period` table left
 * `minimize_exam_week_sessions` reporting zero violations while looking healthy.
 *
 * A PARTIAL overlap is ALLOWED, deliberately. A period running past the end of
 * term is ordinary (an exam week that spills into the following month), only
 * its in-range part classifies anything, and clipping is the natural reading.
 * Refusing it would reject a legitimate configuration to prevent nothing.
 *
 * OVERLAPS BETWEEN PERIODS ARE NOT CHECKED AT ALL, also deliberately. They are
 * meaningful and the precedence rule already resolves them — a holiday inside
 * an exam period is normal, and "EXAM if any exam period touches the week, else
 * whole-week BREAK, else whole-week HOLIDAY" only HAS meaning because periods
 * can overlap. Rejecting them would contradict the resolver already shipped.
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

export const RESOURCES: Record<string, ResourceConfig> = {
    persons: {
        model: 'person',
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
            frequency: z.number().int().min(1).optional(),
            durationBlocks: z.number().int().min(1).optional(),
            requiredRoleId: optionalId,
            requiredCapacity: z.number().int().nonnegative().nullish(),
            allowOnline: z.boolean().optional(),
            isActive: z.boolean().optional(),
            notes: z.string().nullish(),
        }),
        update: z.object({
            kindId: id.optional(),
            code: z.string().nullish(),
            title: z.string().min(1).optional(),
            frequency: z.number().int().min(1).optional(),
            durationBlocks: z.number().int().min(1).optional(),
            requiredRoleId: optionalId,
            requiredCapacity: z.number().int().nonnegative().nullish(),
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
             * not refused.
             *
             * The asymmetry with Sessions above is deliberate and is the whole
             * distinction: an orphaned Session is DATA that resolves to no time
             * and breaks the solver, so the edit is refused. An orphaned break
             * is CONFIGURATION describing a gap between blocks that no longer
             * exist — nothing references it, nothing renders it, and refusing
             * the shrink over it would block a legitimate edit to protect a row
             * whose meaning has already gone.
             *
             * Same transaction as the update, so a failed shrink deletes
             * nothing. Reported rather than silent: this repo's rule is that a
             * guard must not have a failure mode indistinguishable from doing
             * nothing, and quietly discarding a tenant's named lunch would be
             * exactly that.
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
     * Holidays, break weeks and exam periods.
     *
     * ON THE GENERIC SCAFFOLD, DELIBERATELY. The row is four scalars — an enum
     * `kind`, a name, and two dates — with none of what earned the three
     * bespoke editors their slots: no hierarchy (GroupTree), no arithmetic a
     * form field cannot express (TimeGridEditor), no fields that constrain each
     * other (ConstraintBuilder). Offering is the precedent: the hub of the model
     * renders on the generic scaffold because its complexity is registry data,
     * not different code. Only the week PREVIEW is bespoke, and it is one
     * `custom: true` field rather than a page.
     *
     * WHY THIS DID NOT EXIST UNTIL NOW, which is worth recording. The table,
     * the Prisma model, the RLS policy, `buildAcademicCalendar` and the wire
     * have all been in place since the initial schema — but nothing could WRITE
     * a row. So `calendar_period` was empty in every tenant, no week was ever
     * classified EXAM, and `minimize_exam_week_sessions` reported zero
     * violations while looking like it worked. Raising its weight from 5 to
     * 1000 multiplied zero by two hundred.
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
        create: z.object({
            type: z.string().min(1),
            name: z.string().min(1),
            severity: z.enum(['HARD', 'SOFT']),
            /**
             * The DB CHECK enforces the HARD/SOFT ⇄ weight pairing; this only
             * shapes the input.
             *
             * NO CEILING, BY DESIGN — NOT AN OVERSIGHT.
             *
             * A weight has no absolute meaning. The solver derives its
             * hard-violation penalty from the weights themselves:
             *
             *     hard_penalty = sum(all soft weights) * placements + 1
             *                              (calendry-solver, problem.rs)
             *
             * Two consequences follow, and both are why capping the value would
             * be meaningless rather than merely unnecessary:
             *
             *  - Only RATIOS matter. Multiplying every enabled weight by the
             *    same factor leaves every comparison — soft against soft, and
             *    hard against soft — exactly where it was.
             *  - A large weight cannot let a soft rule overrule a hard one.
             *    Raising one weight raises `total_weight`, which raises
             *    `hard_penalty` in the same step, so the lexicographic ordering
             *    (hard first, then soft) survives any magnitude.
             *
             * So "10" is not safer than "10000", and neither is more correct;
             * the only question a tenant can meaningfully answer is how this
             * rule ranks against their OTHER enabled soft rules. That is what
             * the `builder_note` block in ManageConstraintBuilder.vue explains,
             * and the two should not drift.
             *
             * WHAT IS NOT ENFORCED HERE, AND SHOULD BE. There is no lower bound
             * either: `weight: -5` is accepted by this schema and by the
             * database, verified against the live API (HTTP 201). The builder's
             * `min: 1` is an HTML input attribute and stops nothing that does
             * not go through the form. A negative weight is not a harmless
             * oddity — it SUBTRACTS from `total_weight`, lowering the very
             * penalty that keeps hard constraints dominant, and it inverts the
             * rule so the solver prefers what the tenant asked it to avoid.
             *
             * Deliberately left unfixed here: this is the same shape as the
             * tracked "severity is validated too late" gap in CLAUDE.md — the
             * builder honours a rule the generic CRUD API does not — and both
             * belong in one write-boundary fix that has `RESOURCES.constraints`
             * consult `CONSTRAINT_TYPES` in a refinement, rather than another
             * piecemeal patch.
             */
            weight: z.number().int().nullish(),
            params: z.record(z.string(), z.unknown()).optional(),
            isEnabled: z.boolean().optional(),
        }).superRefine(constraintShapeRefinement),
        update: z.object({
            name: z.string().min(1).optional(),
            severity: z.enum(['HARD', 'SOFT']).optional(),
            /** Unbounded above and, currently, below — see `create` above. */
            weight: z.number().int().nullish(),
            params: z.record(z.string(), z.unknown()).optional(),
            isEnabled: z.boolean().optional(),
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
        }),
        update: z.object({
            name: z.string().min(1).optional(),
            color: z.string().nullish(),
            requiresGroup: z.boolean().optional(),
        }),
        filters: z.object({ key: z.string().optional() }),
        orderBy: { key: 'asc' },
        searchFields: ['key', 'name'],
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
