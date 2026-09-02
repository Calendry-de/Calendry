import { z } from 'zod';
import { SolverOutput } from '@calendry-de/calendry-proto';
import {
    planMaterialization, summarizePlanByWeek, summarizeProposedViolations,
} from '../../../utils/generationMaterialize';
import type { MaterializationPlan, PlannedDelete } from '../../../utils/generationMaterialize';
import { GENERATION_SELECT, runSummaryFor } from '../../../utils/generationRead';
import { requirePermission } from '../../../utils/requirePermission';
import { demandLedgerFrom } from '../../../utils/solverDemand';
import { withRequestTenant } from '../../../utils/tenantDb';
import type { Tx } from '../../../utils/tenantDb';

/**
 * What applying this Generation would do: computed, never written.
 *
 * THE POINT OF THIS ROUTE is that it does not compute its own answer. It calls
 * `planMaterialization()`, the same function the apply then executes, so the
 * numbers shown here are the decision the apply carries out rather than a
 * second opinion that happens to agree today.
 *
 * IT IS A SNAPSHOT, NOT A PROMISE. A manual edit between preview and apply
 * legitimately changes the outcome, which is what `computedAt` is for.
 *
 * Gated by `generation.read`; see index.get.ts. `session.read` is deliberately
 * NOT required on top: this returns the placements a proposal WOULD create, not
 * the ones in force, and demanding authority over the applied timetable to read
 * a proposal would make "may review proposals" unexpressible on its own.
 */
const querySchema = z.object({
    include: z.enum(['placements']).optional(),
    termWeek: z.coerce.number().int().optional(),
    groupId: z.string().optional(),
    roomId: z.string().optional(),
    personId: z.string().optional(),
});

export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id');
    const query = await getValidatedQuery(event, querySchema.parse);

    return withRequestTenant(
        event,
        async (tx, identity) => {
            await requirePermission(event, tx, 'generation.read');

            const generation = await tx.generation.findFirst({
                where: { id, tenantId: identity.tenantId },
                select: GENERATION_SELECT,
            });

            if (!generation) {
                throw createError({ statusCode: 404, message: 'Not found.' });
            }

            const run = await runSummaryFor(tx, identity.tenantId, generation.id);

            const stored = run
                ? await tx.solverRun.findFirst({
                    where: { tenantId: identity.tenantId, generationId: generation.id },
                    select: { termId: true, result: true, scope: true, meta: true },
                })
                : null;

            /**
             * A Generation with no run, or a run whose result was never
             * captured, has nothing to preview. Returned as an empty plan with
             * `run: null` rather than a 404 or an error: a manual baseline is a
             * real Generation that simply proposes no changes, and the review
             * screen should say so plainly.
             */
            if (!stored?.result) {
                return {
                    generation,
                    run,
                    plan: emptyCounts(),
                    deletedByOffering: [],
                    /*
                     * A manual baseline asked the solver for nothing, so
                     * `verified` is true and vacuous rather than "unchecked":
                     * there is no run whose answer could be short. The
                     * unchecked case is a SOLVER run with no ledger, which
                     * only reaches the branch below.
                     */
                    demand: { verified: true, required: 0, returned: 0, shortOfferings: 0 },
                    withheldByOffering: [],
                    changesByOffering: { rows: [], untouchedOfferings: 0 },
                    violations: {
                        current: await summarizeCurrentViolations(tx, identity.tenantId, stored?.termId),
                        proposed: { hard: 0, byType: {}, unmappable: 0, sessionReferences: 0 },
                    },
                    weekSummary: [],
                    offerings: [],
                    placements: query.include === 'placements' ? [] : undefined,
                    computedAt: new Date().toISOString(),
                };
            }

            const output = SolverOutput.fromJSON(stored.result);
            const scope = (stored.scope ?? {}) as { offeringIds?: string[] };

            const plan = await planMaterialization(tx, {
                tenantId: identity.tenantId,
                federationId: identity.federationId,
                termId: stored.termId,
                output,
                scopeOfferingIds: scope.offeringIds ?? [],
                // The same evidence the apply reconciles against, read the same
                // way: this route's whole contract is that its numbers ARE the
                // apply's decision, so a preview computed without the ledger
                // would show deletes the apply then refuses to make.
                demandLedger: demandLedgerFrom(stored.meta),
            });

            return {
                generation,
                run,
                plan: plan.counts,
                // The destructive change gets a name, not just a number: a
                // deletion means the solver REFUSED to place that Session, and
                // "8 deleted" is not something a human can act on.
                deletedByOffering: await deletesByOffering(tx, identity.tenantId, plan.deletes),
                /**
                 * WHAT THE RUN ASKED FOR AGAINST WHAT IT ANSWERED, and the
                 * Sessions this plan is keeping because the two disagree.
                 *
                 * The review screen leads with change counts, and a shortfall is
                 * invisible in them: a run that returned 197 of 208 requested
                 * placements produces a proposal that looks complete and simply
                 * deletes eleven Sessions nobody decided to remove. That is now
                 * refused (see `PlanDemand`), which makes it a fact the reviewer
                 * has to be told rather than a silent correction.
                 */
                demand: plan.demand,
                withheldByOffering: await deletesByOffering(
                    tx,
                    identity.tenantId,
                    plan.withheldDeletes,
                ),
                /**
                 * THE CHANGE LIST, and the reason it lives on the server.
                 *
                 * The review page leads with what changes grouped by OFFERING
                 * rather than by slot, because a proposal that moves 187 of 260
                 * Sessions cannot be reviewed one week at a time: thirteen
                 * `<select>` interactions is not a review, it is a search.
                 *
                 * It cannot be built on the client: `placements` is fetched per
                 * `termWeek` (the grid renders a week at a time and the full
                 * output can be ~1000 placements), so no client ever holds the
                 * whole term. `plan` does, right here, already computed for the
                 * counts.
                 */
                changesByOffering: await changesByOffering(
                    tx,
                    identity.tenantId,
                    plan,
                    new Set(scope.offeringIds ?? []),
                ),
                violations: {
                    current: await summarizeCurrentViolations(tx, identity.tenantId, stored.termId),
                    proposed: summarizeProposedViolations(output.hardViolations),
                },
                // Where the changes are, so a nineteen-week term does not have
                // to be clicked through week by week to find the three that moved.
                weekSummary: summarizePlanByWeek(plan),
                /**
                 * Offering names travel WITH the preview rather than being
                 * fetched separately from /api/offerings.
                 *
                 * That endpoint requires `offering.read`, which this route's
                 * own gate (`session.read`) does not imply: a viewer with
                 * session.read got a 403 that rejected the page's whole
                 * reference fetch and rendered a blank screen. A page must
                 * only depend on what its own permission gate guarantees.
                 */
                offerings: await tx.offering.findMany({
                    where: { tenantId: identity.tenantId, termId: stored.termId },
                    select: { id: true, title: true, code: true },
                }),
                placements: query.include === 'placements'
                    ? filterPlacements(plan, query)
                    : undefined,
                computedAt: new Date().toISOString(),
            };
        },
        // Planning reads every Session and Offering in the term; a large tenant
        // will exceed the 5s default exactly as the apply does.
        { timeoutMs: 120_000 },
    );
});

function emptyCounts() {
    return {
        created: 0, moved: 0, movedCollateral: 0, unchanged: 0, deleted: 0,
        deletesWithheld: 0, skippedLocked: 0, placementsUnmapped: 0,
    };
}

/**
 * Violations on the schedule as it stands, so the review screen has a baseline
 * to state alongside the proposal's own count.
 *
 * NOT A DELTA, and this comment used to say it was: the Stage 6c decision the
 * review component enforces is the opposite. These rows come from this app's
 * evaluator, which fills `constraint_violation` from the four STRUCTURAL
 * double-booking rules only, while the proposal's count is the solver reporting
 * on all 14 constraint types. Measured on the same timetable they disagree: the
 * solver reported 23 where this evaluator then found 41 rows. Subtracting them
 * would be the most misleading thing the screen could say, so it renders them as
 * two separate readings with the incomparability stated first.
 *
 * Computed here rather than left to a second client fetch: two independently
 * scoped requests would silently describe different populations.
 */
async function summarizeCurrentViolations(tx: Tx, tenantId: string, termId: string | undefined) {
    const rows = await tx.constraintViolation.findMany({
        where: {
            tenantId,
            ...(termId
                ? {
                    OR: [
                        { session: { termId } },
                        { offering: { termId } },
                    ],
                }
                : {}),
        },
        select: { severity: true, detail: true },
    });

    const byType: Record<string, number> = {};
    let hard = 0;
    let soft = 0;

    for (const row of rows) {
        if (row.severity === 'HARD') {
            hard++;
        } else {
            soft++;
        }

        const detail = (row.detail ?? {}) as { constraintType?: string; reason?: string };
        const key = detail.constraintType ?? detail.reason ?? 'unknown';

        byType[key] = (byType[key] ?? 0) + 1;
    }

    return { hard, soft, byType };
}

/** Which Offerings lose Sessions, and how many each. */
/**
 * What this proposal does to each Offering, over the WHOLE term.
 *
 * Only Offerings something HAPPENS to are returned. An Offering whose every
 * Session is reproduced where it already sits is not a change, and listing it
 * would rebuild the wall of "UNCHANGED" the grid already showed 142 times: the
 * count of those is reported once, as a number, by `untouchedOfferings`.
 *
 * `outOfScope` is the granularity that finally makes `movedCollateral`
 * actionable. The plan reports it as a term-level integer ("12 of them outside
 * what you asked for"), which is the sharpest warning on the screen and, until
 * now, the one with nothing to click. Scope is an OFFERING-level property:
 * `scopeOfferingIds` is what the run was allowed to place, so the Offerings
 * whose Sessions the solver moved on its own initiative can be named, which is
 * exactly the resolution a reviewer needs. A repair run (`LOCK_POLICY_MINIMIZE_
 * MOVEMENT`, empty scope) makes every moved Offering out-of-scope; that is the
 * mode working, not a fault.
 */
async function changesByOffering(
    tx: Tx,
    tenantId: string,
    plan: MaterializationPlan,
    scopeOfferingIds: Set<string>,
) {
    type Row = {
        created: number;
        moved: number;
        unchanged: number;
        deleted: number;
        /** Every term week this Offering changes in, so a row can jump the grid. */
        weeks: Set<number>;
    };

    const rows = new Map<string, Row>();

    const rowFor = (offeringId: string): Row => {
        const existing = rows.get(offeringId);

        if (existing) {
            return existing;
        }

        const fresh: Row = { created: 0, moved: 0, unchanged: 0, deleted: 0, weeks: new Set() };

        rows.set(offeringId, fresh);

        return fresh;
    };

    /**
     * The plan's action names and the reviewer's count names are NOT the same
     * words: the plan says what was done (`create`, `move`), a count says how
     * many are in that state (`created`, `moved`). Indexing a row by the raw
     * action wrote to a key that does not exist, which typecheck caught and a
     * looser type would have shipped as a silent zero on every created session.
     */
    const COUNTER = { create: 'created', move: 'moved', unchanged: 'unchanged' } as const;

    for (const placement of plan.placements) {
        const row = rowFor(placement.offeringId);

        row[COUNTER[placement.action]]++;

        // Only a CHANGE contributes a week. An unchanged placement's week is
        // not somewhere the reviewer needs to be sent.
        if (placement.action !== 'unchanged') {
            row.weeks.add(placement.placement.termWeek);
        }
    }

    for (const del of plan.deletes) {
        // Same reasoning as `deletedByOffering`: skipped rather than coerced, so
        // an Event that somehow reached the delete partition under-reports by
        // one instead of inventing an Offering named "null".
        if (del.offeringId === null) {
            continue;
        }

        const row = rowFor(del.offeringId);

        row.deleted++;
        row.weeks.add(del.placement.termWeek);
    }

    const changedIds = [...rows.entries()]
        .filter(([, row]) => row.created + row.moved + row.deleted > 0)
        .map(([offeringId]) => offeringId);

    const untouchedOfferings = rows.size - changedIds.length;

    if (!changedIds.length) {
        return { rows: [], untouchedOfferings };
    }

    const offerings = await tx.offering.findMany({
        where: { tenantId, id: { in: changedIds } },
        select: { id: true, title: true, code: true },
    });

    const named = new Map(offerings.map((offering) => [offering.id, offering]));

    return {
        rows: changedIds
            .map((offeringId) => {
                const row = rows.get(offeringId)!;
                const offering = named.get(offeringId);

                return {
                    offeringId,
                    // An Offering the tenant cannot read falls back to null
                    // rather than the raw id: a truncated UUID in a list row is
                    // not "visibly wrong", it is unreadable.
                    title: offering?.title ?? null,
                    code: offering?.code ?? null,
                    created: row.created,
                    moved: row.moved,
                    unchanged: row.unchanged,
                    deleted: row.deleted,
                    weeks: [...row.weeks].sort((a, b) => a - b),
                    outOfScope: !scopeOfferingIds.has(offeringId),
                };
            })
            // Destructive first, then most-changed: a removal is the one thing
            // applying cannot undo, so it leads regardless of volume.
            .sort((a, b) => (b.deleted - a.deleted)
                || ((b.created + b.moved) - (a.created + a.moved))
                || (a.title ?? '').localeCompare(b.title ?? '')),
        untouchedOfferings,
    };
}

/**
 * Names for a list of planned deletes, most-affected Offering first.
 *
 * TAKES THE LIST, NOT THE PLAN, because there are now two lists with the same
 * shape and the same need for names: the deletes the apply WILL make, and the
 * ones it withheld because the run's answer came back short. Passing the plan
 * meant hardcoding `plan.deletes` here, and the withheld list would have got a
 * near-identical second copy of this function to drift from it.
 */
async function deletesByOffering(tx: Tx, tenantId: string, rows: PlannedDelete[]) {
    if (!rows.length) {
        return [];
    }

    const counts = new Map<string, number>();

    for (const del of rows) {
        // Unreachable by construction (the delete partition excludes Events
        // explicitly), but skipped rather than coerced, so that if it ever DID
        // happen this would under-report by one rather than invent an Offering
        // named "null" in the reviewer's summary.
        if (del.offeringId === null) {
            continue;
        }

        counts.set(del.offeringId, (counts.get(del.offeringId) ?? 0) + 1);
    }

    const offerings = await tx.offering.findMany({
        where: { tenantId, id: { in: [...counts.keys()] } },
        select: { id: true, title: true, code: true },
    });

    return offerings
        .map((offering) => ({
            offeringId: offering.id,
            title: offering.title,
            code: offering.code,
            count: counts.get(offering.id) ?? 0,
        }))
        .sort((a, b) => b.count - a.count);
}

/**
 * Placements for one week, filtered like `/api/sessions` is.
 *
 * The grid renders a week at a time, and the full output can be ~1000
 * placements, so the header must not pay for the grid's payload.
 *
 * Group/room/person filters match the placement's OWN ids rather than resolving
 * nested groups: a proposal's placements are not rows yet, so there is nothing
 * to join against. Nested-group filtering is a 6c concern if it proves needed.
 */
function filterPlacements(plan: MaterializationPlan, query: {
    termWeek?: number;
    groupId?: string;
    roomId?: string;
    personId?: string;
}) {
    const matches = (ids: string[], wanted: string | undefined) => !wanted || ids.includes(wanted);

    const placements = plan.placements.filter((p) => (
        (query.termWeek === undefined || p.placement.termWeek === query.termWeek)
        && matches(p.groupIds, query.groupId)
        // Against the FULL Room set, not the primary. A reviewer filtering by
        // the second hall of a two-hall lecture was shown nothing, which reads
        // as "this room is free", the same room the placement occupies.
        && matches(p.roomIds, query.roomId)
        && matches([...p.lecturerIds, ...p.personIds], query.personId)
    ));

    // Deletions belong in the same view: a Session vanishing from Monday is a
    // change the reviewer needs to see, and it has a placement to show it at.
    const deletes = plan.deletes.filter((d) => (
        query.termWeek === undefined || d.placement.termWeek === query.termWeek
    ));

    return [
        ...placements,
        ...deletes.map((d) => ({
            action: 'delete' as const,
            sessionId: d.sessionId,
            offeringId: d.offeringId,
            placement: d.placement,
            previous: d.placement,
            roomId: null,
            groupIds: [],
            lecturerIds: [],
            personIds: [],
        })),
    ];
}
