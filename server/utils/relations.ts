import { z } from 'zod';
import type { Tx } from './tenantDb';

/**
 * Registry for the join tables hanging off a core entity.
 *
 * WHY THESE ARE NOT IN `RESOURCES`
 * --------------------------------
 * A membership row is not an independent record. `offering_group` has no
 * identity of its own, nobody links to one, and nothing means anything about it
 * except "this Offering involves that Group". Giving it its own CRUD surface
 * would invite the UI to treat it as a thing, when what the user actually edits
 * is a SET on the parent: pick the groups this offering is for.
 *
 * SO THE VERB IS PUT-SET, NOT POST/DELETE PER ROW
 * -----------------------------------------------
 * `PUT /api/offerings/:id/groups` replaces the whole collection in one
 * transaction. This matches how a multi-select is actually used, it is
 * idempotent, and it removes an entire class of half-applied state: with
 * per-row calls, a form that adds two and removes one is three requests that
 * can partially fail, leaving a relation set nobody chose.
 *
 * PERMISSION IS THE PARENT'S `.update`
 * ------------------------------------
 * Changing which rooms an Offering needs IS editing the Offering. A separate
 * `offering_equipment.update` permission would be authority over a table rather
 * than over a decision, which is not how the catalogue is organised.
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
     * parent key — both are supplied by the server.
     */
    item: z.ZodTypeAny;
    /** Columns returned on GET, in addition to the parent key. */
    select: Record<string, boolean>;
    /**
     * Permissions accepted by the PUT, ANY one of which is sufficient.
     *
     * Absent means the parent's own `.update`, which is the rule stated at the
     * top of this file and right for every relation that describes what the
     * parent NEEDS: changing which rooms an Offering requires IS editing the
     * Offering.
     *
     * `persons/access-roles` is the case it does not fit. Granting somebody
     * authority is not editing a person, and the catalogue already says so —
     * `person_access_role.assign` is its own capability precisely so a tenant
     * can let a registrar assign existing roles without also letting them
     * rename people. Defaulting it to `person.update` would hand every person
     * editor the ability to make themselves an administrator.
     *
     * READS are deliberately not overridable and stay on the parent's `.read`:
     * seeing who holds which role inside your own tenant is not privileged, and
     * gating it would blank the Person page for anyone who may edit people.
     */
    writePermission?: readonly string[];
    /**
     * True when the join table has no `tenant_id` column of its own.
     * `room_equipment` is the odd one out: its tenant column is nullable because
     * a federation-owned Room has no owning tenant.
     */
    tenantColumnNullable?: boolean;
    /**
     * Advisory notes about what the just-written set IMPLIES, surfaced next to
     * the control without refusing the write.
     *
     * Warn-and-allow, matching TAXONOMY.md §3's rule for manual edits: the
     * consequence is stated, the user's decision stands. Run INSIDE the write
     * transaction and AFTER the replacement, so the notes describe the new set
     * rather than the one being replaced.
     *
     * THE SHAPE OF THE PUT RESPONSE DEPENDS ON THIS FIELD. A relation that
     * declares it returns `{ rows, warnings }`; every other relation returns the
     * bare array it always did. That is the same conditional-shape pattern the
     * list route uses for `limit`, and it is what keeps this from being a
     * breaking change for the five relations that do not want warnings.
     */
    warnAfterWrite?: (ctx: {
        tx: Tx;
        tenantId: string;
        /** The parent row's id — for `groups/terms`, the Group. */
        id: string;
        /** The set as just written. */
        rows: Record<string, unknown>[];
    }) => Promise<string[]>;
}

/** One Term that still uses a Group it is no longer scoped to. */
interface OrphanedScope {
    name: string;
    offerings: number;
    sessions: number;
}

/**
 * Terms this Group is no longer scoped to, but whose Offerings or Sessions
 * still reference it.
 *
 * WHY THIS WARNS RATHER THAN REFUSES
 *
 * Nothing breaks. `group_term` is a VISIBILITY scope — which Groups a picker
 * offers — and the solver never reads it: `assembleSolverInput` derives the
 * Groups it needs from what Offerings and Sessions actually reference
 * (solverGroups.ts), precisely so tenant configuration cannot make an input
 * internally inconsistent. So the existing links keep working and the next
 * solve is unaffected either way.
 *
 * What DOES change is that the Group stops appearing in that Term's pickers, so
 * a link removed by accident cannot be re-added without first restoring the
 * scope. That is worth saying out loud and not worth blocking over.
 *
 * The query is the backfill's shape (`groupTermBackfill.ts`) inverted: instead
 * of "which Terms does usage imply", it asks "which Terms does usage imply that
 * the new scope now excludes". Both sources, because a Session can carry a
 * Group its Offering does not.
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
            + 'They keep working and the solver is unaffected — this group just will not appear in '
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
        // database CHECK rejects 0 and 8 as well — a grid cannot have a break
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
     * Which Terms a Group is available in.
     *
     * A PUT-set like every other collection here. NO ROWS MEANS EVERY TERM, so
     * saving an empty list is a meaningful action — it WIDENS the Group back to
     * universal rather than hiding it everywhere. That is the one thing about
     * this relation that reads backwards at first glance, and it is why the
     * editor labels the empty state rather than leaving a blank list.
     *
     * Permission is the parent's `group.update`, per the rule above: changing
     * when a Group applies IS editing the Group.
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
     * Which AccessRoles a Person holds — what they may DO, as opposed to what
     * they ARE (`persons/roles`, immediately above, is the scheduling
     * vocabulary and grants nothing).
     *
     * A PUT-set like every other collection here, and the picker is
     * `ManageRelationPicker` unchanged: this genuinely is a choice among
     * existing rows, unlike a role's own permissions, which are code and live
     * on the role's payload instead.
     *
     * Behind `person_access_role.assign` rather than `person.update` — see
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
            statusMessage: `Unknown relation '${parent}/${relation}'.`,
        });
    }

    return config;
}

/** Same containment reasoning as `delegate` in resources.ts. */
export function relationDelegate(tx: Tx, model: string) {
    const d = (tx as unknown as Record<string, unknown>)[model];

    if (!d) {
        throw createError({ statusCode: 500, statusMessage: `No Prisma delegate '${model}'.` });
    }

    return d as {
        findMany: (args: unknown) => Promise<unknown[]>;
        deleteMany: (args: unknown) => Promise<{ count: number }>;
        createMany: (args: unknown) => Promise<{ count: number }>;
    };
}
