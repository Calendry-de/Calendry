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
 * template id — the one place both the pre-write completeness check and
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
 * Core of "apply a curriculum plan to a Group in a Term" — see
 * `offering-plan-apply/[id].post.ts` for the full reasoning (reuse over
 * duplicate, keyed on `(term, createdFromTemplateId)`, so two Groups taking
 * the same subject in one Term join one Offering rather than each getting
 * their own).
 *
 * Split out of the route so `scripts/seed-demo-schedule.ts` can build its
 * demo curriculum through the SAME path a tenant would use — one definition
 * of what applying a plan means, not a second one that quietly drifts from
 * it. Takes already-loaded items (each with its template row) and already-
 * validated ids: confirming the plan/term/Group exist and belong to the
 * tenant, and refusing an incomplete template before calling this, are the
 * caller's job — an HTTP 404/422 and a script's thrown Error are different
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
                allowOnline: t.allowOnline ?? undefined,
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

/** Plan items whose template cannot yet seed an Offering — see the route's own comment. */
export function incompleteTemplateNames(items: { template: OfferingTemplate }[]): string[] {
    return items.filter((item) => !item.template.kindId || !item.template.title).map((item) => item.template.name);
}
