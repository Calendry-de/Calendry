import type { OfferingTemplate } from '@prisma/client';
import type { Tx } from './tenantDb';

export interface OfferingPlanApplyItem {
    id: string;
    title: string;
    action: 'created' | 'attached' | 'already-attached';
}

type ExistingOffering = { id: string; title: string; createdFromTemplateId: string | null; groups: { groupId: string }[] };

/**
 * Which of these templates already seeded an Offering in this Term, keyed by
 * template id: the one place both the pre-write completeness check and
 * `applyOfferingPlanItems` below ask "does this need creating," so the two
 * can never disagree about it.
 */
export async function existingOfferingsByTemplate(
    tx: Tx,
    params: { tenantId: string; termId: string; templateIds: string[] },
): Promise<Map<string, ExistingOffering>> {
    const rows = await tx.offering.findMany({
        where: {
            tenantId: params.tenantId,
            termId: params.termId,
            createdFromTemplateId: { in: params.templateIds },
        },
        select: { id: true, title: true, createdFromTemplateId: true, groups: { select: { groupId: true } } },
    });

    return new Map(rows.map((offering) => [offering.createdFromTemplateId as string, offering]));
}

/**
 * Core of "apply a curriculum plan to a Group in a Term": see
 * `offering-plan-apply/[id].post.ts` for the full reasoning (reuse over
 * duplicate, keyed on `(term, createdFromTemplateId)`, so two Groups taking
 * the same subject in one Term join one Offering rather than each getting
 * their own).
 *
 * Split out of the route so `scripts/seed-demo-schedule.ts` can build its
 * demo curriculum through the SAME path a tenant would use: one definition
 * of what applying a plan means, not a second one that quietly drifts from
 * it. Takes already-loaded items (each with its template row) and already-
 * validated ids: confirming the plan/term/Group exist and belong to the
 * tenant, and refusing an incomplete template before calling this, are the
 * caller's job, since an HTTP 404/422 and a script's thrown Error are different
 * enough shapes that inventing a third, generic one here would serve neither.
 */
export async function applyOfferingPlanItems(
    tx: Tx,
    params: {
        tenantId: string;
        termId: string;
        groupId: string;
        items: { templateId: string; template: OfferingTemplate }[];
    },
): Promise<OfferingPlanApplyItem[]> {
    const { tenantId, termId, groupId, items } = params;

    const existingByTemplate = await existingOfferingsByTemplate(tx, {
        tenantId,
        termId,
        templateIds: items.map((item) => item.templateId),
    });

    const results: OfferingPlanApplyItem[] = [];

    for (const item of items) {
        const existing = existingByTemplate.get(item.templateId);

        if (existing) {
            const alreadyAttached = existing.groups.some((g) => g.groupId === groupId);

            if (!alreadyAttached) {
                await tx.offeringGroup.create({
                    data: { tenantId, offeringId: existing.id, groupId },
                });
            }

            results.push({ id: existing.id, title: existing.title, action: alreadyAttached ? 'already-attached' : 'attached' });

            continue;
        }

        const t = item.template;

        const offering = await tx.offering.create({
            data: {
                tenantId,
                termId,
                // The caller's job: refuse before this point if either is null.
                kindId: t.kindId!,
                title: t.title!,
                code: t.code,
                color: t.color,
                frequency: t.frequency ?? undefined,
                durationBlocks: t.durationBlocks ?? undefined,
                schedulingPattern: t.schedulingPattern,
                requiredRoleId: t.requiredRoleId,
                requiredCapacity: t.requiredCapacity,
                requiredRoomCount: t.requiredRoomCount ?? undefined,
                onlineMode: t.onlineMode ?? undefined,
                notes: t.notes,
                createdFromTemplateId: t.id,
                groups: { create: { tenantId, groupId } },
            },
            select: { id: true, title: true },
        });

        results.push({ id: offering.id, title: offering.title, action: 'created' });
    }

    return results;
}

/** Plan items whose template cannot yet seed an Offering: see the route's own comment. */
export function incompleteTemplateNames(items: { template: OfferingTemplate }[]): string[] {
    return items.filter((item) => !item.template.kindId || !item.template.title).map((item) => item.template.name);
}

/** One curriculum plan a Group already has Offerings from, and where it could go next. */
export interface GroupPlanApplication {
    planId: string;
    planName: string;
    termId: string;
    termName: string;
    /** Present only when the plan names a successor AND a later Term exists to move into. */
    advance: { planId: string; planName: string; termId: string; termName: string } | null;
}

/**
 * "Which curriculum plan(s) is each Group already on, and what would
 * 'advance' apply next": the ONE derivation, shared by the per-Group detail
 * (`group-plan-applications/[id].get.ts`), the tenant-wide list
 * (`group-plan-applications/index.get.ts`), and the bulk advance action
 * (`group-plan-applications/advance-all.post.ts`), so the three can never
 * disagree about what "this Group's current phase" means.
 *
 * DERIVED, NOT STORED: same reasoning the single-Group route already
 * documented: nothing records "this apply came from this plan",
 * `Offering.createdFromTemplateId` is the only trail, so this reconstructs it
 * by joining back through `OfferingPlanItem`. A template belonging to more
 * than one plan surfaces as more than one application for the same Offering,
 * which is the honest answer.
 *
 * `groupIds` omitted means EVERY Group in the tenant that has at least one
 * such Offering: the shape the tenant-wide list and the bulk action need;
 * passing one id is exactly what the per-Group route already did before this
 * was extracted.
 */
export async function deriveGroupPlanApplications(
    tx: Tx,
    tenantId: string,
    groupIds?: string[],
): Promise<Map<string, GroupPlanApplication[]>> {
    const offerings = await tx.offering.findMany({
        where: {
            tenantId,
            createdFromTemplateId: { not: null },
            groups: groupIds ? { some: { groupId: { in: groupIds } } } : { some: {} },
        },
        select: {
            termId: true,
            createdFromTemplateId: true,
            term: { select: { id: true, name: true, startDate: true } },
            groups: { select: { groupId: true } },
        },
    });

    if (!offerings.length) {
        return new Map();
    }

    const templateIds = [...new Set(offerings.map((o) => o.createdFromTemplateId as string))];

    const items = await tx.offeringPlanItem.findMany({
        where: { tenantId, templateId: { in: templateIds } },
        select: {
            templateId: true,
            plan: {
                select: {
                    id: true,
                    name: true,
                    nextPlan: { select: { id: true, name: true } },
                },
            },
        },
    });

    const plansByTemplate = new Map<string, (typeof items)[number]['plan'][]>();

    for (const item of items) {
        const bucket = plansByTemplate.get(item.templateId) ?? [];

        bucket.push(item.plan);
        plansByTemplate.set(item.templateId, bucket);
    }

    // All Terms once, ordered: the "next Term after this one" lookup below
    // is a scan of this list rather than a query per application.
    const terms = await tx.term.findMany({
        where: { tenantId },
        select: { id: true, name: true, startDate: true },
        orderBy: { startDate: 'asc' },
    });

    const byGroup = new Map<string, (GroupPlanApplication & { termStart: Date })[]>();
    const seenByGroup = new Map<string, Set<string>>();

    for (const offering of offerings) {
        const plans = plansByTemplate.get(offering.createdFromTemplateId as string) ?? [];
        const nextTerm = terms.find((term) => term.startDate > offering.term.startDate);

        for (const { groupId } of offering.groups) {
            if (groupIds && !groupIds.includes(groupId)) {
                continue;
            }

            const seen = seenByGroup.get(groupId) ?? new Set<string>();

            seenByGroup.set(groupId, seen);

            const bucket = byGroup.get(groupId) ?? [];

            byGroup.set(groupId, bucket);

            for (const plan of plans) {
                const key = `${plan.id}:${offering.termId}`;

                if (seen.has(key)) {
                    continue;
                }

                seen.add(key);

                bucket.push({
                    planId: plan.id,
                    planName: plan.name,
                    termId: offering.termId,
                    termName: offering.term.name,
                    termStart: offering.term.startDate,
                    advance: plan.nextPlan && nextTerm
                        ? { planId: plan.nextPlan.id, planName: plan.nextPlan.name, termId: nextTerm.id, termName: nextTerm.name }
                        : null,
                });
            }
        }
    }

    const result = new Map<string, GroupPlanApplication[]>();

    for (const [groupId, applications] of byGroup) {
        const seen = seenByGroup.get(groupId) ?? new Set<string>();

        for (const application of applications) {
            /*
             * ALREADY THERE, so nothing left to "advance": `plan.nextPlan`
             * and a later Term existing says nothing about whether this Group
             * has ALREADY made that exact move. Without this check, an old
             * application whose successor was applied years ago would offer
             * the identical "advance" forever: harmless for the single-Group
             * button (re-applying is idempotent, see `applyOfferingPlanItems`)
             * but wrong for a BULK caller: `advance-all` would re-confirm
             * every transition a tenant has ever made, on every run, forever,
             * and "N groups eligible" would never shrink to zero even once
             * every Group is fully caught up.
             */
            if (application.advance && seen.has(`${application.advance.planId}:${application.advance.termId}`)) {
                application.advance = null;
            }
        }

        // Chronological, so "what's next" always reads as the row after the
        // group's most recent Term rather than requiring the reader to sort it
        // out from term names.
        applications.sort((a, b) => a.termStart.getTime() - b.termStart.getTime());
        result.set(groupId, applications.map(({ termStart: _termStart, ...application }) => application));
    }

    return result;
}
