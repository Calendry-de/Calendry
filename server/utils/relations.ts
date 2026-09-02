import { z } from 'zod';
import type { Tx } from './tenantDb';
import { assertTenantRetainsAdministrator } from './accessRoleGuards';

/**
 * Registry for the join tables hanging off a core entity.
 *
 * NOT IN `RESOURCES` because a membership row is not an independent record:
 * `offering_group` has no identity, nobody links to one, and what the user edits
 * is a SET on the parent.
 *
 * SO THE VERB IS PUT-SET: `PUT /api/offerings/:id/groups` replaces the whole
 * collection in one transaction. Idempotent, and it removes a class of
 * half-applied state: per-row calls make "add two, remove one" three requests
 * that can partially fail, leaving a set nobody chose.
 *
 * PERMISSION IS THE PARENT'S `.update`: changing which rooms an Offering needs IS
 * editing the Offering. A per-table permission would be authority over a table
 * rather than over a decision.
 */
export interface RelationConfig {
    /** Parent resource segment, e.g. 'offerings'. Must exist in RESOURCES. */
    parent: string;
    /** Prisma delegate for the PARENT, used to verify it exists in this tenant. */
    parentModel: string;
    /** Prisma delegate for the join table. */
    model: string;
    /** Column holding the parent's id on the join table. */
    parentKey: string;
    /**
     * Zod schema for ONE item of the replacement set, without tenant_id or the
     * parent key; both are supplied by the server.
     */
    item: z.ZodTypeAny;
    /** Columns returned on GET, in addition to the parent key. */
    select: Record<string, boolean>;
    /**
     * Permissions accepted by the PUT, ANY one sufficient. Absent means the
     * parent's `.update`, which is right for every relation describing what the
     * parent NEEDS.
     *
     * `persons/access-roles` is the case it does not fit: granting authority is not
     * editing a person, and defaulting it to `person.update` would hand every
     * person editor the ability to make themselves an administrator.
     *
     * READS stay on the parent's `.read`: gating them would blank the Person page
     * for anyone who may edit people.
     */
    writePermission?: readonly string[];
    /**
     * True when the join table has no `tenant_id` column of its own.
     * `room_equipment` is the odd one out: its tenant column is nullable because
     * a federation-owned Room has no owning tenant.
     */
    tenantColumnNullable?: boolean;
    /**
     * Advisory notes about what the just-written set IMPLIES, surfaced next to the
     * control without refusing the write. Runs inside the transaction AFTER the
     * replacement, so the notes describe the new set.
     *
     * THE SHAPE OF THE PUT RESPONSE DEPENDS ON THIS FIELD: a relation declaring it
     * returns `{ rows, warnings }`, every other returns the bare array, which is
     * what keeps it from being a breaking change for the five that do not want them.
     */
    warnAfterWrite?: (ctx: {
        tx: Tx;
        tenantId: string;
        /** The parent row's id; for `groups/terms`, the Group. */
        id: string;
        /** The set as just written. */
        rows: Record<string, unknown>[];
    }) => Promise<string[]>;
    /**
     * An invariant about the state the write LEAVES BEHIND. Runs inside the
     * transaction after the replacement; throwing rolls it back.
     *
     * Not folded into `warnAfterWrite`, which is advisory and never a refusal:
     * conflating them would make one hook's return value sometimes advice and
     * sometimes a veto.
     */
    afterWrite?: (ctx: { tx: Tx; tenantId: string; id: string }) => Promise<void>;
}

/** One Term that still uses a Group it is no longer scoped to. */
interface OrphanedScope {
    name: string;
    offerings: number;
    sessions: number;
}

/**
 * Terms this Group is no longer scoped to, but whose Offerings or Sessions still
 * reference it.
 *
 * WARNS RATHER THAN REFUSES because nothing breaks: `group_term` is a VISIBILITY
 * scope and the solver never reads it: `assembleSolverInput` derives the Groups it
 * needs from what is actually referenced, precisely so tenant configuration cannot
 * make an input inconsistent. What does change is that the Group stops appearing in
 * that Term's pickers, so an accidental removal cannot be undone without first
 * restoring the scope.
 *
 * The query is the backfill's shape inverted. Both sources, because a Session can
 * carry a Group its Offering does not.
 */
async function groupTermScopeWarnings(ctx: {
    tx: Tx;
    tenantId: string;
    id: string;
    rows: Record<string, unknown>[];
}): Promise<string[]> {
    /**
     * No rows means "available in every Term" (see the migration), so nothing is
     * scoped out and nothing can be orphaned. Returning early also keeps the
     * `<> ALL('{}')` edge case out of the query, where an empty array would make
     * every Term match.
     */
    if (ctx.rows.length === 0) {
        return [];
    }

    const scopedTermIds = ctx.rows.map((row) => String(row.termId));

    const orphaned = await ctx.tx.$queryRaw<OrphanedScope[]>`
        SELECT t.name,
               count(DISTINCT og.offering_id)::int AS offerings,
               count(DISTINCT sg.session_id)::int  AS sessions
          FROM term t
          LEFT JOIN offering o
                 ON o.term_id = t.id
          LEFT JOIN offering_group og
                 ON og.offering_id = o.id AND og.group_id = ${ctx.id}
          LEFT JOIN session s
                 ON s.term_id = t.id
          LEFT JOIN session_group sg
                 ON sg.session_id = s.id AND sg.group_id = ${ctx.id}
         WHERE t.tenant_id = ${ctx.tenantId}
           AND NOT (t.id = ANY(${scopedTermIds}::text[]))
         GROUP BY t.id, t.name
        HAVING count(og.offering_id) + count(sg.session_id) > 0
         ORDER BY t.name
    `;

    return orphaned.map((row) => {
        const parts: string[] = [];

        if (row.offerings > 0) {
            parts.push(`${row.offerings} Offering${row.offerings === 1 ? '' : 's'}`);
        }

        if (row.sessions > 0) {
            parts.push(`${row.sessions} Session${row.sessions === 1 ? '' : 's'}`);
        }

        // The "solver is unaffected" clause is not reassurance padding: it is
        // true by construction, and without it the warning reads as though a
        // timetable is about to break.
        return `Scoped out of ${row.name}, but ${parts.join(' and ')} in that term still use this group. `
            + 'They keep working and the solver is unaffected; this group just will not appear in '
            + `group pickers for ${row.name}.`;
    });
}

const id = z.string().min(1);

export const RELATIONS: Record<string, RelationConfig> = {
    /**
     * Named, non-uniform break overrides on a TimeGrid.
     *
     * A PUT-set like every other collection here: the editor holds the whole
     * list, and "add one, change one, remove one" is one request that either
     * lands or does not. Per-row calls would let a form half-apply into a
     * schedule nobody chose.
     *
     * Permission is the parent's `time_grid.update`, per the rule above:
     * changing when a grid breaks IS editing the grid.
     */
    'time-grids/breaks': {
        parent: 'time-grids',
        parentModel: 'timeGrid',
        model: 'timeGridBreak',
        parentKey: 'timeGridId',
        // `dayOfWeek: null` is universal; 1..7 is a specific ISO weekday. The
        // database CHECK rejects 0 and 8 as well: a grid cannot have a break
        // on a day no Session can occupy.
        item: z.object({
            afterBlockIndex: z.number().int().min(0),
            durationMinutes: z.number().int().min(1),
            label: z.string().min(1),
            dayOfWeek: z.number().int().min(1).max(7).nullish(),
        }),
        select: { id: true, afterBlockIndex: true, durationMinutes: true, label: true, dayOfWeek: true },
    },

    /**
     * Which Terms a Group is available in. NO ROWS MEANS EVERY TERM, so saving an
     * empty list WIDENS the Group back to universal rather than hiding it. It is the one
     * thing here that reads backwards, and why the editor labels the empty state.
     */
    'groups/terms': {
        parent: 'groups',
        parentModel: 'group',
        model: 'groupTerm',
        parentKey: 'groupId',
        item: z.object({ termId: id }),
        select: { termId: true },
        warnAfterWrite: groupTermScopeWarnings,
    },

    /**
     * Groups a combined Group draws its members from.
     *
     * NOT in the manage registry's `relations` array, like `groups/availability`
     * below and for a related reason: editing the set is only half the feature.
     * The other half is an ACTION (copy those members in), and a panel that
     * saved the sources while the membership silently stayed as it was would be
     * the most misleading version of this possible. `ManageGroupForm` renders
     * both together.
     *
     * A PUT-set like every other collection here, so "add one, drop one" is one
     * request that either lands or does not.
     */
    'groups/sources': {
        parent: 'groups',
        parentModel: 'group',
        model: 'groupSource',
        parentKey: 'groupId',
        item: z.object({ sourceGroupId: id }),
        select: { sourceGroupId: true },
    },

    /**
     * When a Group is available inside each Term: the cohort that runs only the
     * first six weeks.
     *
     * NOT in the manage registry's `relations` array, deliberately, so the
     * generic `ManageRelationsPanel` does not render it. That panel edits a SET
     * of links with at most one number or one reference per row, and this needs
     * two dates; declared here it still gets the PUT-set machinery, the tenant
     * column, and the `group.update` gate for free while the UI stays bespoke
     * inside `ManageGroupForm`, per the "bespoke means one slot" rule.
     *
     * ABSENT ROW MEANS THE WHOLE TERM, so removing a row is how a tenant clears
     * a window. A PUT-set gives that for nothing: a term dropped from the
     * submitted list has its row deleted.
     */
    'groups/availability': {
        parent: 'groups',
        parentModel: 'group',
        model: 'groupTermAvailability',
        parentKey: 'groupId',
        /*
         * Both bounds optional, at least one required. The DB CHECK says the
         * same thing, and a row with neither is exactly what an absent row
         * already means. Refused here so the caller gets a 400 naming the field
         * rather than a constraint-violation 500.
         */
        item: z.object({
            termId: id,
            availableFrom: z.coerce.date().nullish(),
            availableTo: z.coerce.date().nullish(),
        }).refine(
            (row) => row.availableFrom != null || row.availableTo != null,
            { message: 'A window needs a start date, an end date, or both. Remove the term to clear it.' },
        ).refine(
            (row) => row.availableFrom == null
                || row.availableTo == null
                || row.availableFrom <= row.availableTo,
            { message: 'The window ends before it starts.' },
        ),
        select: { termId: true, availableFrom: true, availableTo: true },
    },

    'offerings/groups': {
        parent: 'offerings',
        parentModel: 'offering',
        model: 'offeringGroup',
        parentKey: 'offeringId',
        item: z.object({ groupId: id }),
        select: { groupId: true },
    },

    'offerings/lecturers': {
        parent: 'offerings',
        parentModel: 'offering',
        model: 'offeringLecturer',
        parentKey: 'offeringId',
        // roleId is the SCHEDULING role this person fills here (TAXONOMY.md §2),
        // not an access role. Nullable: many kinds do not constrain it.
        item: z.object({ personId: id, roleId: id.nullish() }),
        select: { personId: true, roleId: true },
    },

    'offerings/equipment': {
        parent: 'offerings',
        parentModel: 'offering',
        model: 'offeringEquipment',
        parentKey: 'offeringId',
        item: z.object({ equipmentId: id, quantity: z.number().int().positive().nullish() }),
        select: { equipmentId: true, quantity: true },
    },

    'rooms/equipment': {
        parent: 'rooms',
        parentModel: 'room',
        model: 'roomEquipment',
        parentKey: 'roomId',
        item: z.object({ equipmentId: id, quantity: z.number().int().positive().nullish() }),
        select: { equipmentId: true, quantity: true },
        tenantColumnNullable: true,
    },

    'persons/roles': {
        parent: 'persons',
        parentModel: 'person',
        model: 'personRole',
        parentKey: 'personId',
        item: z.object({ roleId: id }),
        select: { roleId: true },
    },

    /**
     * Which AccessRoles a Person holds: what they may DO, as opposed to what they
     * ARE (`persons/roles` above is scheduling vocabulary and grants nothing).
     *
     * Behind `person_access_role.assign` rather than `person.update`; see
     * `writePermission`.
     */
    'persons/access-roles': {
        parent: 'persons',
        parentModel: 'person',
        model: 'personAccessRole',
        parentKey: 'personId',
        item: z.object({ accessRoleId: id }),
        select: { accessRoleId: true },
        writePermission: ['person_access_role.assign'],
        afterWrite: ({ tx, tenantId }) => assertTenantRetainsAdministrator(tx, tenantId),
    },

    'persons/groups': {
        parent: 'persons',
        parentModel: 'person',
        model: 'membership',
        parentKey: 'personId',
        item: z.object({ groupId: id }),
        select: { groupId: true },
    },

    'constraints/scopes': {
        parent: 'constraints',
        parentModel: 'constraint',
        model: 'constraintScope',
        parentKey: 'constraintId',
        // Either narrows the constraint; both null would mean "everything",
        // which is already what having no scope rows means.
        item: z.object({ offeringId: id.nullish(), kindId: id.nullish() })
            .refine((v) => Boolean(v.offeringId) || Boolean(v.kindId), {
                message: 'A scope must name an offering, a kind, or both.',
            }),
        select: { offeringId: true, kindId: true },
    },
};

export function getRelation(parent: string | undefined, relation: string | undefined): RelationConfig {
    const config = parent && relation ? RELATIONS[`${parent}/${relation}`] : undefined;

    if (!config) {
        throw createError({
            statusCode: 404,
            message: `Unknown relation '${parent}/${relation}'.`,
        });
    }

    return config;
}

/** Same containment reasoning as `delegate` in resources.ts. */
export function relationDelegate(tx: Tx, model: string) {
    const d = (tx as unknown as Record<string, unknown>)[model];

    if (!d) {
        throw createError({ statusCode: 500, message: `No Prisma delegate '${model}'.` });
    }

    return d as {
        findMany: (args: unknown) => Promise<unknown[]>;
        deleteMany: (args: unknown) => Promise<{ count: number }>;
        createMany: (args: unknown) => Promise<{ count: number }>;
    };
}
