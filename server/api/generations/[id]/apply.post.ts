import { z } from 'zod';
import { SolverOutput } from '@calendry-de/calendry-proto';
import { mapDbErrors } from '../../../utils/dbErrors';
import { materializeGeneration } from '../../../utils/generationMaterialize';
import { appendEvent } from '../../../utils/sessionEvents';
import { requirePermission } from '../../../utils/requirePermission';
import { demandLedgerFrom } from '../../../utils/solverDemand';
import { withRequestTenant } from '../../../utils/tenantDb';
import { refreshViolations } from '../../../utils/violations';

const bodySchema = z.object({ reason: z.string().nullish() }).optional();

/**
 * Promote a Generation to the tenant's current baseline.
 *
 * ONE batch event, not one per Session. The Generation is already the immutable
 * record of these placements (TAXONOMY.md §3), so per-Session events would store
 * the same data twice and make replay ambiguous — a replayer could not tell
 * whether to apply the snapshot, the events, or both. The event log's role is
 * manual deltas layered on a baseline; applying a Generation replaces the
 * baseline rather than being a delta on it. Volume confirms it: a large
 * university would otherwise write five figures of rows per click.
 *
 * Locked Sessions are left exactly as they are — the solver never overwrites a
 * lock, so neither does applying its output.
 *
 * STAGE 5 CHANGED WHAT THIS DOES. It used to only RE-BASELINE: stamp the new
 * generation id onto existing Sessions and flip `is_current`. That was correct
 * when every Session was placed by hand, but a SOLVER Generation carries
 * placements that exist nowhere yet — they live in `solver_run.result` until
 * this moment, precisely so review-before-apply reviews an unchanged schedule.
 *
 * So a solver Generation now MATERIALIZES first (create / move / delete), then
 * re-baselines exactly as before. A manual or imported Generation has no run
 * attached and takes the original path untouched.
 */
export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id');
    const body = (await readValidatedBody(event, bodySchema.parse)) ?? {};

    return withRequestTenant(
        event,
        async (tx, identity) => {
            await requirePermission(event, tx, 'generation.apply');

            const generation = await tx.generation.findFirst({
                where: { id, tenantId: identity.tenantId },
            });

            if (!generation) {
                throw createError({ statusCode: 404, statusMessage: 'Not found.' });
            }

            if (generation.status === 'INFEASIBLE' || generation.status === 'FAILED') {
                throw createError({
                    statusCode: 409,
                    statusMessage: `Generation is ${generation.status} and has no placements to apply.`,
                });
            }

            if (generation.isCurrent) {
                return { generation, applied: 0, skippedLocked: 0, event: null, alreadyCurrent: true };
            }

            /**
             * THE TERM'S OWN CURRENT SCHEDULE, not the tenant's.
             *
             * This looked up `{tenantId, isCurrent: true}` with no term
             * condition and then marked what it found SUPERSEDED — so applying
             * Semester 3's proposal marked Semester 1's live schedule as
             * superseded, and the demo tenant ended up with five terms' records
             * reading "discarded or superseded" that nobody had discarded. The
             * partial unique index was tenant-wide too, so the two agreed with
             * each other and disagreed with the product.
             *
             * `generation.termId` is the scope: matching on it means a NULL-term
             * tenant-wide baseline supersedes only another tenant-wide one,
             * which is the invariant the two partial indexes now enforce.
             */
            const previous = await tx.generation.findFirst({
                where: {
                    tenantId: identity.tenantId,
                    termId: generation.termId,
                    isCurrent: true,
                },
                select: { id: true, version: true },
            });

            /*
             * Locked Sessions keep their manual placement and their old
             * baseline — counted WITHIN THE TERM being applied, since that is
             * the only set this apply can touch. Tenant-wide, the number
             * reported to the user included locks in terms nothing was
             * happening to.
             */
            const lockedCount = await tx.session.count({
                where: {
                    tenantId: identity.tenantId,
                    isLocked: true,
                    ...(generation.termId ? { termId: generation.termId } : {}),
                },
            });

            // Clear the current flag before setting the new one: a partial unique
            // index permits only one current Generation per term, so the order
            // matters.
            await mapDbErrors(async () => {
                if (previous) {
                    await tx.generation.update({
                        where: { id: previous.id },
                        data: { isCurrent: false, status: 'SUPERSEDED' },
                    });
                }

                await tx.generation.update({
                    where: { id: generation.id },
                    data: { isCurrent: true, status: 'APPLIED', appliedAt: new Date() },
                });
            });

            /**
             * A solver Generation reaches its placements through the run that
             * produced it. Nothing was copied onto the Generation itself — the
             * payload can be megabytes and duplicating it would make the two
             * copies able to disagree.
             */
            const run = await tx.solverRun.findFirst({
                where: { tenantId: identity.tenantId, generationId: generation.id },
                select: { id: true, termId: true, result: true, scope: true, meta: true },
            });

            let materialized = null;

            if (run?.result) {
                const scope = (run.scope ?? {}) as { offeringIds?: string[] };

                materialized = await mapDbErrors(() => materializeGeneration(tx, {
                    tenantId: identity.tenantId,
                    federationId: identity.federationId,
                    termId: run.termId,
                    generationId: generation.id,
                    output: SolverOutput.fromJSON(run.result),
                    scopeOfferingIds: scope.offeringIds ?? [],
                    /**
                     * What this run ASKED the solver for. Without it an apply
                     * cannot tell "the solver refused to place this Session"
                     * from "the solver's answer was short and never mentioned
                     * it", and deletes the Session either way — which is how
                     * eleven live placements per run went missing. Null for a
                     * run started before the ledger existed; see `PlanDemand`.
                     */
                    demandLedger: demandLedgerFrom(run.meta),
                    actorPersonId: identity.actorPersonId,
                }));
            }

            /**
             * Rebase the applied TERM only, and never an Event.
             *
             * This used to be `{ tenantId, isLocked: false }` — every unlocked
             * Session in the tenant, regardless of term. Applying a Generation
             * for one term therefore rewrote `generation_id` on every other
             * term's Sessions too, attributing them to a Generation that never
             * placed them. Provenance damage rather than data loss, which is
             * why nothing caught it: the schedule renders identically either
             * way, and `generation_id` is only read when someone asks where a
             * placement came from.
             *
             * `offeringId: { not: null }` excludes Events for the same reason:
             * a human placed it, so "which solver run produced this" has the
             * answer NONE, and overwriting that with a Generation id would make
             * the row indistinguishable from solver output.
             *
             * THE GENERATION'S OWN TERM FIRST, its run's only as a fallback. The
             * term used to come from the run alone, which left the same hole one
             * case over: a Generation carrying a term but NO run — an import, or
             * a solver row whose run was cleaned up — matched no term condition
             * at all and rebased every term in the tenant, which is the very
             * thing the paragraph above describes fixing. A term-less
             * tenant-wide Generation still rebases tenant-wide, which is what it
             * means.
             */
            const rebaseTermId = generation.termId ?? run?.termId ?? null;

            const rebased = await tx.session.updateMany({
                where: {
                    tenantId: identity.tenantId,
                    isLocked: false,
                    ...(rebaseTermId ? { termId: rebaseTermId } : {}),
                    offeringId: { not: null },
                },
                data: { generationId: generation.id },
            });

            const logged = await appendEvent(tx, identity, {
                type: 'APPLY_GENERATION',
                generationId: generation.id,
                payload: {
                    generationId: generation.id,
                    version: generation.version,
                    previousGenerationId: previous?.id ?? null,
                    previousVersion: previous?.version ?? null,
                    sessionsRebased: rebased.count,
                    sessionsSkippedLocked: lockedCount,
                    // Still ONE event, not one per Session (see above). The
                    // materialization counts ride along so a replay can see
                    // what this apply actually did to the schedule.
                    ...(materialized ? { materialized: { ...materialized } } : {}),
                },
                reason: body.reason,
            });

            const affected = await tx.session.findMany({
                where: { tenantId: identity.tenantId, generationId: generation.id },
                select: { id: true },
            });

            await refreshViolations(tx, {
                tenantId: identity.tenantId,
                federationId: identity.federationId,
                sessionIds: affected.map((s) => s.id),
                detectedByEventId: logged.id,
                generationId: generation.id,
            });

            return {
                generation: await tx.generation.findFirst({ where: { id: generation.id } }),
                applied: rebased.count,
                skippedLocked: lockedCount,
                materialized,
                event: logged,
                alreadyCurrent: false,
            };
        },
        // The one bulk operation in the API: re-baselining every unlocked Session
        // and re-evaluating their violations will exceed the 5s default on a
        // large tenant.
        { timeoutMs: 120_000 },
    );
});
