import type { Prisma } from '@prisma/client';
import { PER_SESSION_CONSTRAINT_TYPES, RELATION_CONSTRAINT_TYPES, STRUCTURAL_CONSTRAINT_TYPES } from '../../shared/constraintTypes';
import type { StructuralConstraintType } from '../../shared/constraintTypes';
import { gapsWithinSpan } from '../../shared/timeGrid';
import type { Tx } from './tenantDb';
import { conflictGroupIds, descendantGroupIds } from './groupClosure';

/**
 * Constraint evaluation for manual edits — the warn-and-allow half of
 * TAXONOMY.md §3.
 *
 * SCOPE: only the STRUCTURAL hard constraints a manual edit can break, which are
 * decidable from placement data alone. Anything parameterised or preference-shaped
 * belongs to the Rust solver and is registered below as an explicit TODO rather
 * than silently omitted.
 *
 * A violation row can only be written against a Constraint the tenant configured
 * (`constraint_id` is a NOT NULL FK), so a tenant without
 * `no_double_booking_room` gets no room-collision warnings. Provisioning is
 * responsible for the baseline hard constraints.
 */

/**
 * The two type lists moved to `shared/constraintTypes.ts` in Step 13, so the
 * rule-builder UI and this evaluator read ONE declaration. A type the builder
 * offered but this file did not know would be a constraint a tenant can enable,
 * that reports nothing, and that means nothing.
 *
 * Re-exported here so every existing importer keeps working unchanged.
 */
// Relative, not `#shared`: this module is loaded OUTSIDE Nuxt too — by
// scripts/ and by vitest — where Nuxt's aliases do not exist. App code under
// app/ can use `#shared` freely because it only ever runs inside Nuxt.
export {
    STRUCTURAL_CONSTRAINT_TYPES,
    PER_SESSION_CONSTRAINT_TYPES,
    RELATION_CONSTRAINT_TYPES,
    SOLVER_OWNED_CONSTRAINT_TYPES,
} from '../../shared/constraintTypes';
export type {
    StructuralConstraintType, PerSessionConstraintType, RelationConstraintType,
} from '../../shared/constraintTypes';

interface PlacedSession {
    id: string;
    /** Null for a Federation-shared Session — it belongs to no member tenant. */
    tenantId: string | null;
    termId: string;
    kindId: string;
    offeringId: string;
    termWeek: number;
    dayOfWeek: number;
    blockIndex: number;
    durationBlocks: number;
}

/**
 * A seed, additionally carrying its own TimeGrid — needed only by the
 * per-session pass below, which is why `candidates` does not select it: a
 * candidate is never checked for spanning a break, only for colliding with a
 * seed.
 */
interface SeedSession extends PlacedSession {
    timeGridId: string | null;
}

/** Half-open block ranges [start, start+duration) overlap. */
function blocksOverlap(a: PlacedSession, b: PlacedSession): boolean {
    return (
        a.termId === b.termId
        && a.termWeek === b.termWeek
        && a.dayOfWeek === b.dayOfWeek
        && a.blockIndex < b.blockIndex + b.durationBlocks
        && b.blockIndex < a.blockIndex + a.durationBlocks
    );
}

interface RefreshOptions {
    tenantId: string;
    /** Set when the tenant belongs to a Federation, so shared Sessions count. */
    federationId?: string | null;
    sessionIds: string[];
    detectedByEventId?: string | null;
    generationId?: string | null;
}

/**
 * Recomputes constraint_violation rows for the given Sessions and every Session
 * they collide with, in the caller's transaction.
 *
 * Called synchronously by every editing route, so the persisted violation state
 * is never stale relative to the event that caused it.
 */
export async function refreshViolations(tx: Tx, options: RefreshOptions): Promise<number> {
    const {
        tenantId, federationId = null, sessionIds,
        detectedByEventId = null, generationId = null,
    } = options;

    /**
     * Sessions this tenant must consider for collisions: its own, plus any
     * Federation-shared ones. A shared event occupies a real room in a real
     * slot, so excluding it would report a clean schedule that is not.
     *
     * Only ever used for READING. Violations themselves stay tenant-scoped —
     * `constraint_violation.tenant_id` is this tenant's row about its own
     * schedule, even when the other party is a shared Session.
     */
    const visibleToTenant = federationId
        ? [{ tenantId }, { federationId }]
        : [{ tenantId }];

    if (sessionIds.length === 0) {
        return 0;
    }

    /**
     * EVERY structural constraint the tenant has, enabled or not — then the enabled
     * subset. The distinction is what makes DISABLING take effect:
     * `clearViolations` removes rows for the ids it is given, so passing only the
     * enabled ones left a disabled rule's violations in the table with nothing to
     * delete them, and the toggle looked broken.
     *
     * Note the asymmetry it removes: the `length === 0` branch passed an EMPTY id
     * list, which `clearViolations` treats as "no filter" and deletes everything —
     * so "no rules at all" cleared correctly while "one of several disabled" did not.
     */
    const configured = await tx.constraint.findMany({
        where: {
            tenantId,
            type: {
                in: [
                    ...STRUCTURAL_CONSTRAINT_TYPES, ...PER_SESSION_CONSTRAINT_TYPES, ...RELATION_CONSTRAINT_TYPES,
                ],
            },
        },
        select: { id: true, type: true, severity: true, weight: true, isEnabled: true },
    });

    const clearableIds = configured.map((c) => c.id);
    const enabled = configured.filter((c) => c.isEnabled);

    // Nothing ENABLED means nothing to record. Collisions still happen; the
    // tenant simply has not asked to be warned about them — and anything a
    // previously-enabled rule recorded is cleared rather than stranded.
    if (enabled.length === 0) {
        await clearViolations(tx, tenantId, sessionIds, clearableIds);

        return 0;
    }

    const seeds = (await tx.session.findMany({
        where: { OR: visibleToTenant, id: { in: sessionIds } },
        select: {
            id: true, tenantId: true, termId: true, kindId: true, offeringId: true,
            termWeek: true, dayOfWeek: true, blockIndex: true, durationBlocks: true,
            timeGridId: true,
        },
    })) as SeedSession[];

    if (seeds.length === 0) {
        return 0;
    }

    // Candidate collision set: every Session sharing a term/week/day with a seed.
    // Narrowing by week and day first keeps this bounded — the alternative is
    // scanning the term.
    const candidates = (await tx.session.findMany({
        where: {
            OR: visibleToTenant,
            AND: [{
                OR: seeds.map((s) => ({
                    termId: s.termId,
                    termWeek: s.termWeek,
                    dayOfWeek: s.dayOfWeek,
                })),
            }],
        },
        select: {
            id: true, tenantId: true, termId: true, kindId: true, offeringId: true,
            termWeek: true, dayOfWeek: true, blockIndex: true, durationBlocks: true,
        },
    })) as PlacedSession[];

    const involvedIds = [...new Set([...seeds.map((s) => s.id), ...candidates.map((c) => c.id)])];

    const [rooms, people, groups, virtualRooms] = await Promise.all([
        tx.sessionRoom.findMany({ where: { sessionId: { in: involvedIds } }, select: { sessionId: true, roomId: true } }),
        tx.sessionPerson.findMany({ where: { sessionId: { in: involvedIds } }, select: { sessionId: true, personId: true } }),
        tx.sessionGroup.findMany({ where: { sessionId: { in: involvedIds } }, select: { sessionId: true, groupId: true } }),
        tx.room.findMany({ where: { isVirtual: true }, select: { id: true } }),
    ]);

    const virtualRoomIds = new Set(virtualRooms.map((room) => room.id));

    /**
     * Virtual rooms host unlimited concurrent sessions — TAXONOMY.md models online
     * delivery AS a room precisely so room-assignment logic stays uniform.
     *
     * Excluded at the CONSTRUCTION site rather than inside `describeCollision`, so
     * a future check reading `byRoom` cannot forget the exemption. Keyed on the
     * `is_virtual` flag, not a well-known room: nothing restricts a tenant to one.
     *
     * The solver assumed the opposite until `calendry-solver@99b41e3`; both sides
     * now key on the flag.
     */
    const byRoom = groupBy(
        rooms.filter((row) => !virtualRoomIds.has(row.roomId)),
        'sessionId',
        'roomId',
    );
    const byPerson = groupBy(people, 'sessionId', 'personId');
    const byGroup = groupBy(groups, 'sessionId', 'groupId');

    /**
     * Who actually ATTENDS each Session — direct participants plus the members of
     * every group beneath the ones assigned to it.
     *
     * DESCENDANTS ONLY, not the conflict closure: membership flows downward, so
     * being in Seminar A1 makes you part of Class A's cohort but not the reverse.
     * Same direction the solver's `expand_subtree` uses.
     */
    const attendeeSets = new Map<string, Set<string>>();

    {
        const groupsPerSession = new Map<string, string[]>();

        for (const sessionId of involvedIds) {
            groupsPerSession.set(sessionId, await descendantGroupIds(tx, byGroup.get(sessionId) ?? []));
        }

        const allGroupIds = [...new Set([...groupsPerSession.values()].flat())];

        const memberships = allGroupIds.length
            ? await tx.membership.findMany({
                where: { groupId: { in: allGroupIds } },
                select: { groupId: true, personId: true },
            })
            : [];

        const membersByGroup = groupBy(memberships, 'groupId', 'personId');

        for (const sessionId of involvedIds) {
            const people = new Set(byPerson.get(sessionId) ?? []);

            for (const groupId of groupsPerSession.get(sessionId) ?? []) {
                for (const personId of membersByGroup.get(groupId) ?? []) {
                    people.add(personId);
                }
            }

            attendeeSets.set(sessionId, people);
        }
    }

    // Expand each Session's groups to its full conflict set once, up front.
    // Doing this inside the pair loop would re-query the closure O(n²) times.
    const conflictSets = new Map<string, Set<string>>();

    for (const sessionId of involvedIds) {
        const direct = byGroup.get(sessionId) ?? [];
        conflictSets.set(sessionId, new Set(await conflictGroupIds(tx, direct)));
    }

    interface Detected {
        constraintId: string;
        sessionId: string;
        severity: 'HARD' | 'SOFT';
        penalty: number | null;
        detail: Prisma.InputJsonObject;
    }

    const detected: Detected[] = [];

    /*
     * THREE SHAPES OF `enabled` ROW, dispatched separately: `describeCollision`'s
     * switch is exhaustive over the PAIRWISE types and has no case for a
     * per-session or relation one, so neither is ever handed to it.
     */
    const pairwiseEnabled = enabled.filter(
        (c) => !PER_SESSION_CONSTRAINT_TYPES.includes(c.type as never)
            && !RELATION_CONSTRAINT_TYPES.includes(c.type as never),
    );
    const perSessionEnabled = enabled.filter(
        (c) => PER_SESSION_CONSTRAINT_TYPES.includes(c.type as never),
    );
    const relationEnabled = enabled.filter(
        (c) => RELATION_CONSTRAINT_TYPES.includes(c.type as never),
    );

    for (const constraint of pairwiseEnabled) {
        for (const seed of seeds) {
            for (const other of candidates) {
                if (other.id === seed.id || !blocksOverlap(seed, other)) {
                    continue;
                }

                const collision = describeCollision(
                    constraint.type as StructuralConstraintType,
                    seed,
                    other,
                    { byRoom, byPerson, byGroup, conflictSets, attendeeSets },
                );

                if (!collision) {
                    continue;
                }

                detected.push({
                    constraintId: constraint.id,
                    sessionId: seed.id,
                    severity: constraint.severity as 'HARD' | 'SOFT',
                    penalty: constraint.severity === 'SOFT' ? constraint.weight : null,
                    detail: { ...collision, collidesWithSessionId: other.id },
                });
            }
        }
    }

    /**
     * PER-SESSION: one Session, its own TimeGrid, no counterpart. Grids are
     * fetched ONCE per distinct `timeGridId` among the seeds, not once per
     * (constraint, seed) — the pairwise loop above re-uses precomputed closures
     * for the same reason.
     */
    if (perSessionEnabled.length > 0) {
        const gridIds = [...new Set(seeds.map((s) => s.timeGridId).filter((id): id is string => id !== null))];

        const grids = gridIds.length
            ? await tx.timeGrid.findMany({
                where: { id: { in: gridIds } },
                select: {
                    id: true, blocksPerDay: true, blockLengthMinutes: true,
                    startHour: true, startMinute: true, breakMinutes: true,
                    breaks: { select: { afterBlockIndex: true, durationMinutes: true, label: true, dayOfWeek: true } },
                },
            })
            : [];

        const gridById = new Map(grids.map((grid) => [grid.id, grid]));

        for (const constraint of perSessionEnabled) {
            for (const seed of seeds) {
                // No grid, nothing to check against — the same "named rather
                // than filtered" reasoning `fitsGrid` callers already follow:
                // a null timeGridId here means there is no rule to violate,
                // not that the rule passed.
                const grid = seed.timeGridId ? gridById.get(seed.timeGridId) : undefined;

                if (!grid) {
                    continue;
                }

                const gaps = gapsWithinSpan(
                    grid,
                    seed.blockIndex,
                    seed.durationBlocks,
                    seed.dayOfWeek,
                );

                if (gaps.length === 0) {
                    continue;
                }

                detected.push({
                    constraintId: constraint.id,
                    sessionId: seed.id,
                    severity: constraint.severity as 'HARD' | 'SOFT',
                    penalty: constraint.severity === 'SOFT' ? constraint.weight : null,
                    detail: {
                        reason: 'session_spans_break',
                        gaps: gaps.map((g) => ({ afterBlockIndex: g.afterBlockIndex, minutes: g.minutes, label: g.label })),
                    },
                });
            }
        }
    }

    /**
     * RELATION-BASED: keyed by explicit `ConstraintRelationMember` membership,
     * not a shared Room/Lecturer/Group/Person `describeCollision` already has
     * loaded — the same reason `PER_SESSION_CONSTRAINT_TYPES` gets its own pass
     * rather than a case in that switch (`shared/constraintTypes.ts`'s comment
     * on `RELATION_CONSTRAINT_TYPES`).
     *
     * REUSES `candidates`, not a new query: a relation violation still needs
     * `blocksOverlap` (same term/week/day), and `candidates` already holds
     * every Session sharing one with ANY seed — a relation's OTHER member
     * Offering's Session is already in there if it could possibly overlap.
     */
    if (relationEnabled.length > 0) {
        const members = await tx.constraintRelationMember.findMany({
            where: { constraintId: { in: relationEnabled.map((c) => c.id) } },
            select: { constraintId: true, offeringId: true },
        });

        const membersByConstraint = new Map<string, Set<string>>();

        for (const m of members) {
            const set = membersByConstraint.get(m.constraintId) ?? new Set<string>();

            set.add(m.offeringId);
            membersByConstraint.set(m.constraintId, set);
        }

        for (const constraint of relationEnabled) {
            const memberOfferingIds = membersByConstraint.get(constraint.id) ?? new Set<string>();

            // A dangling-member relation (see `assembleSolverInput`'s report)
            // still names real Offerings here — this reads `Offering.id`
            // directly, never the solver's snapshot — so this only fires for
            // a relation that never had two members at all.
            if (memberOfferingIds.size < 2) {
                continue;
            }

            for (const seed of seeds) {
                if (!memberOfferingIds.has(seed.offeringId)) {
                    continue;
                }

                for (const other of candidates) {
                    if (
                        other.id === seed.id
                        || other.offeringId === seed.offeringId
                        || !memberOfferingIds.has(other.offeringId)
                        || !blocksOverlap(seed, other)
                    ) {
                        continue;
                    }

                    detected.push({
                        constraintId: constraint.id,
                        sessionId: seed.id,
                        severity: constraint.severity as 'HARD' | 'SOFT',
                        penalty: constraint.severity === 'SOFT' ? constraint.weight : null,
                        detail: {
                            reason: 'different_time_violated',
                            collidesWithSessionId: other.id,
                            collidesWithOfferingId: other.offeringId,
                        },
                    });
                }
            }
        }
    }

    // `clearableIds`, not `enabled` — see the note above. A rule that was
    // switched off must have its old rows removed, not merely stop adding new
    // ones.
    await clearViolations(tx, tenantId, involvedIds, clearableIds);

    for (const d of detected) {
        /**
         * find-then-write rather than `upsert`. Prisma cannot express a
         * compound unique key containing NULLABLE columns, and this one is
         * (constraint_id, session_id, offering_id) with NULLS NOT DISTINCT —
         * a shape the schema language has no way to describe. The index still
         * enforces uniqueness in the database; this is only how it is reached.
         */
        const existing = await tx.constraintViolation.findFirst({
            where: { constraintId: d.constraintId, sessionId: d.sessionId, offeringId: null },
            select: { id: true },
        });

        if (existing) {
            await tx.constraintViolation.update({
                where: { id: existing.id },
                data: {
                    severity: d.severity,
                    penalty: d.penalty,
                    detail: d.detail,
                    detectedByEventId,
                    generationId,
                    detectedAt: new Date(),
                },
            });
        } else {
            await tx.constraintViolation.create({
                data: {
                    tenantId,
                    constraintId: d.constraintId,
                    sessionId: d.sessionId,
                    offeringId: null,
                    severity: d.severity,
                    penalty: d.penalty,
                    detail: d.detail,
                    detectedByEventId,
                    generationId,
                },
            });
        }
    }

    return detected.length;
}

export function describeCollision(
    type: StructuralConstraintType,
    a: PlacedSession,
    b: PlacedSession,
    ctx: {
        byRoom: Map<string, string[]>;
        byPerson: Map<string, string[]>;
        /** Each Session's DIRECTLY assigned Groups — never the closure. */
        byGroup: Map<string, string[]>;
        conflictSets: Map<string, Set<string>>;
        /** Everyone attending each Session: direct participants + group members. */
        attendeeSets: Map<string, Set<string>>;
    },
): Prisma.InputJsonObject | null {
    switch (type) {
        case 'no_double_booking_room': {
            const shared = intersect(ctx.byRoom.get(a.id) ?? [], ctx.byRoom.get(b.id) ?? []);

            return shared.length ? { reason: 'room_double_booked', roomIds: shared } : null;
        }

        case 'no_double_booking_lecturer': {
            const shared = intersect(ctx.byPerson.get(a.id) ?? [], ctx.byPerson.get(b.id) ?? []);

            return shared.length ? { reason: 'person_double_booked', personIds: shared } : null;
        }

        case 'no_double_booking_group': {
            /**
             * Nested-group propagation, expanded on ONE side only.
             *
             * A Session booked for a Cohort blocks its child Seminars and vice
             * versa (TAXONOMY.md §6), so one side is widened to its ancestors and
             * descendants — but the other must be matched by IDENTITY.
             *
             * Intersecting two EXPANDED sets makes any two Groups sharing a common
             * ancestor collide, however distantly:
             *
             *     Seminar A1 → {Seminar A1, Class A, Informatics 2026}
             *     Class B    → {Class B,            Informatics 2026}
             *     ∩          = {Informatics 2026}   ← a false positive
             *
             * That produced 24 phantom violations against real demo data, on a
             * schedule the solver reported as clean. The outcome is symmetric
             * despite looking one-sided; the reported ids are `b`'s own Groups,
             * which is what a human needs rather than an inferred ancestor.
             */
            const closureA = ctx.conflictSets.get(a.id) ?? new Set<string>();
            const directB = ctx.byGroup.get(b.id) ?? [];
            const shared = [...new Set(directB)].filter((g) => closureA.has(g));

            return shared.length ? { reason: 'group_double_booked', groupIds: shared } : null;
        }

        case 'no_double_booking_person': {
            /**
             * Catches what the group rule structurally CANNOT: a person in two
             * groups unrelated in the nesting tree, both scheduled at once.
             *
             * Both sides expand all the way down to PEOPLE and intersect by
             * identity. Symmetric expansion is safe here — and would not be for
             * groups — because people are leaves, so the "shares an ancestor" false
             * positive cannot arise.
             */
            const setA = ctx.attendeeSets.get(a.id) ?? new Set<string>();
            const setB = ctx.attendeeSets.get(b.id) ?? new Set<string>();
            const shared = [...setA].filter((personId) => setB.has(personId));

            return shared.length ? { reason: 'person_double_booked', personIds: shared } : null;
        }

        default:
            return null;
    }
}

async function clearViolations(tx: Tx, tenantId: string, sessionIds: string[], constraintIds: string[]) {
    await tx.constraintViolation.deleteMany({
        where: {
            tenantId,
            sessionId: { in: sessionIds },
            // Scoped to session-shaped rows on purpose. `sessionId IN (...)`
            // already excludes NULLs, so a solver-produced offering-scoped
            // violation survives a manual-edit refresh — this evaluator has no
            // opinion about those and must not silently clear them.
            offeringId: null,
            ...(constraintIds.length ? { constraintId: { in: constraintIds } } : {}),
        },
    });
}

function groupBy<T extends Record<string, string>>(rows: T[], keyField: keyof T, valueField: keyof T) {
    const map = new Map<string, string[]>();

    for (const row of rows) {
        const key = row[keyField] as string;
        const list = map.get(key) ?? [];

        list.push(row[valueField] as string);
        map.set(key, list);
    }

    return map;
}

function intersect(a: string[], b: string[]): string[] {
    const set = new Set(b);

    return a.filter((x) => set.has(x));
}
