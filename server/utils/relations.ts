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

/** One Group whose lecturer pin names somebody outside the Offering's pool. */
interface StrandedLecturerPin {
    groupName: string;
    personName: string;
}

/**
 * Groups of this Offering whose per-Group lecturer pin (issue #131,
 * `offering_group.lecturer_person_id`) names a person who is NOT in the
 * Offering's candidate pool (`offering_lecturer`).
 *
 * Shared by BOTH writes that can produce the state: saving `groups` with a
 * pin the picker never offered, and saving `lecturers` so that a pinned
 * person leaves the pool. The pin is deliberately not a foreign key onto the
 * pool (see the schema comment on `OfferingGroup`), so this is the only place
 * the two tables are read together at write time.
 *
 * WARNS RATHER THAN REFUSES, for the same reason the pool has no CHECK against
 * `requiredLecturerCount`: the two sets are saved by separate requests, and
 * refusing the roster edit would make "remove Ms Y from the pool" fail on a
 * pin the editor may not even see. `assembleSolverInput` reports the same
 * condition and falls back to the pool for that series, so nothing silently
 * narrows; this note is what tells the person who just saved that it will.
 */
async function lecturerPinWarnings(ctx: { tx: Tx; tenantId: string; id: string }): Promise<string[]> {
    const stranded = await ctx.tx.$queryRaw<StrandedLecturerPin[]>`
        SELECT g.name                          AS "groupName",
               concat_ws(' ', p.given_name, p.family_name) AS "personName"
          FROM offering_group og
          JOIN "group" g  ON g.id = og.group_id
          JOIN person p   ON p.id = og.lecturer_person_id
         WHERE og.offering_id = ${ctx.id}
           AND og.tenant_id = ${ctx.tenantId}
           AND og.lecturer_person_id IS NOT NULL
           AND NOT EXISTS (
                   SELECT 1
                     FROM offering_lecturer ol
                    WHERE ol.offering_id = og.offering_id
                      AND ol.person_id = og.lecturer_person_id
               )
         ORDER BY g.name
    `;

    return stranded.map((row) => (
        `${row.groupName} is pinned to ${row.personName}, who is not in "Who leads it". `
        + 'The pin is kept but ignored: the solver will choose from the pool for that group '
        + 'until the person is added back or the pin is cleared.'
    ));
}

/**
 * What a footprint set may not contain, checked on the state the write leaves
 * behind (issue #122): the Room itself, and any virtual Room on either end.
 *
 * REFUSED WITH A FIELD, before the database would. Both rules also exist as a
 * CHECK (`room_footprint_not_self`) and a trigger
 * (`room_footprint_refuse_virtual`), which are the backstop for a write that
 * bypasses this route; here they answer 422 naming `otherRoomId` so the form can
 * point at the control instead of surfacing a constraint name. A virtual Room
 * has no physical footprint, and the solver refuses one at conversion, which
 * would fail the whole tenant's run long after the save.
 */
async function roomFootprintInvariants(ctx: { tx: Tx; tenantId: string; id: string }): Promise<void> {
    const rows = await ctx.tx.roomFootprint.findMany({
        where: { roomId: ctx.id },
        select: { otherRoomId: true, otherRoom: { select: { isVirtual: true, name: true } } },
    });

    if (rows.some((row) => row.otherRoomId === ctx.id)) {
        throw createError({
            statusCode: 422,
            message: 'A room cannot share a footprint with itself.',
            data: { field: 'otherRoomId' },
        });
    }

    const virtual = rows.filter((row) => row.otherRoom.isVirtual).map((row) => row.otherRoom.name);

    if (virtual.length) {
        throw createError({
            statusCode: 422,
            message: `A virtual room has no physical footprint: ${virtual.join(', ')}.`,
            data: { field: 'otherRoomId' },
        });
    }

    const self = await ctx.tx.room.findFirst({ where: { id: ctx.id }, select: { isVirtual: true } });

    if (rows.length && self?.isVirtual) {
        throw createError({
            statusCode: 422,
            message: 'A virtual room has no physical footprint; make it a physical room first.',
            data: { field: 'otherRoomId' },
        });
    }
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

    /**
     * Which Groups an Offering is for — one row per SERIES of a split Offering.
     *
     * `lecturerPersonId` is the per-Group LECTURER PIN (issue #131): the one
     * person who always leads THIS Group's Sessions, narrowing that series'
     * wire candidates below the Offering-wide pool. Null (the default, and what
     * every row was before the column existed) means "choose from the pool".
     * Meant to name a pool member; a pin outside it is warned about here, and
     * reported and ignored at assembly, never silently honoured or silently
     * dropped. See the schema comment on `OfferingGroup` for why it is not a
     * foreign key onto the pool.
     */
    'offerings/groups': {
        parent: 'offerings',
        parentModel: 'offering',
        model: 'offeringGroup',
        parentKey: 'offeringId',
        item: z.object({ groupId: id, lecturerPersonId: id.nullish() }),
        select: { groupId: true, lecturerPersonId: true },
        warnAfterWrite: lecturerPinWarnings,
    },

    /**
     * The candidate pool: who MAY lead the Offering. Warns when the new roster
     * leaves a per-Group pin (`offerings/groups` above) naming somebody who is
     * no longer in it.
     */
    'offerings/lecturers': {
        parent: 'offerings',
        parentModel: 'offering',
        model: 'offeringLecturer',
        parentKey: 'offeringId',
        // roleId is the SCHEDULING role this person fills here (TAXONOMY.md §2),
        // not an access role. Nullable: many kinds do not constrain it.
        item: z.object({ personId: id, roleId: id.nullish() }),
        select: { personId: true, roleId: true },
        warnAfterWrite: lecturerPinWarnings,
    },

    /**
     * The template's OWN half of `offering_lecturer` (issue #129): a NAMED
     * roster, so applying a plan seeds the created Offering's `lecturers`
     * relation instead of leaving it empty (issue #130). Same shape as
     * `offerings/lecturers` above, deliberately: a template's roster and an
     * Offering's roster are the same kind of fact, one stored, one seeded
     * from it.
     */
    'offering-templates/lecturers': {
        parent: 'offering-templates',
        parentModel: 'offeringTemplate',
        model: 'offeringTemplateLecturer',
        parentKey: 'templateId',
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

    /**
     * The ROOM PIN (issue #123): "only these Rooms may host this Offering".
     *
     * AN ALLOW-LIST, NOT A PREFERENCE, and an EMPTY SET IS THE DEFAULT MEANING
     * "any eligible Room" — verbatim what the wire's empty `allowed_room_ids`
     * has always meant, so clearing this control restores today's behaviour
     * exactly rather than pinning the Offering to nothing.
     *
     * NO `tenantColumnNullable`, unlike `rooms/equipment`: the row belongs to
     * the OFFERING's tenant, not the Room's, so it always has one even when the
     * Room it names is federation-owned (which is allowed, and is the case a
     * consortium's shared lecture hall is).
     *
     * NOTHING IS REFUSED HERE. A pin can make an Offering structurally
     * unplaceable (too few Rooms for `requiredRoomCount`, none big enough, none
     * left after `onlineMode = REQUIRED` intersects it), but capacity, features
     * and activity are edited elsewhere, by someone else, later. The
     * impossibilities are reported by `assembleSolverInput`'s `AssemblyReport`,
     * the same way `unsatisfiableEquipmentQuantities` is.
     */
    'offerings/rooms': {
        parent: 'offerings',
        parentModel: 'offering',
        model: 'offeringRoom',
        parentKey: 'offeringId',
        item: z.object({ roomId: id }),
        select: { roomId: true },
    },

    /**
     * The OTHER Rooms this one is the same physical space as (issue #122,
     * reworked from free-text tags; see the `RoomFootprint` schema comment).
     *
     * Edited from EITHER side: the table is mirrored by trigger, so replacing
     * this Room's set also rewrites the other direction on every Room it names,
     * and the generic delete-then-insert below needs no knowledge of that.
     * The wire derives one footprint tag per pair (`toWireRoom`), so the
     * solver's non-transitive expansion is exactly what the pairs say.
     */
    'rooms/footprint': {
        parent: 'rooms',
        parentModel: 'room',
        model: 'roomFootprint',
        parentKey: 'roomId',
        item: z.object({ otherRoomId: id }),
        select: { otherRoomId: true },
        tenantColumnNullable: true,
        afterWrite: roomFootprintInvariants,
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
