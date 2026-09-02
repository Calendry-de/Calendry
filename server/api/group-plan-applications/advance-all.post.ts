import { mapDbErrors } from '../../utils/dbErrors';
import { requirePermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';
import {
    applyOfferingPlanItems, deriveGroupPlanApplications, existingOfferingsByTemplate, incompleteTemplateNames,
} from '../../utils/offeringPlans';

defineRouteMeta({
    openAPI: {
        tags: ['Curriculum plans'],
        summary: 'Advance every eligible Group to its own next curriculum plan',
        description: 'The bulk "phase change" action: every Group holding an application whose plan names a successor (nextPlanId) AND a later Term exists to move into gets that successor plan applied for that Term, each Group to its OWN target, not one plan/term picked for everybody. Manual only, triggered from the curriculum-progression settings page; nothing here runs on its own. Idempotent per Group/plan/term the same way a single apply is: re-running finds every Offering already has the Group and changes nothing.',
        responses: {
            200: { description: 'advanced: one entry per Group actually moved. failed: one entry per (plan, term) batch that could not be applied, naming every Group it would have covered.' },
            403: { description: 'Caller lacks offering_plan.apply.' },
        },
    },
});

interface AdvancedGroup {
    groupId: string;
    groupName: string;
    fromPlanName: string;
    toPlanId: string;
    toPlanName: string;
    toTermName: string;
    offerings: number;
}

interface FailedBatch {
    planId: string;
    planName: string;
    termId: string;
    termName: string;
    groupIds: string[];
    reason: string;
}

/**
 * Bulk "advance": issue #100's actual shape once "which phase is a Group
 * in" turned out to already be answerable with no new entity. Nothing here
 * is stored either, it just runs the SAME per-Group advance a person could
 * already trigger one at a time (`ManageGroupApplyPlan.vue`'s "Advance"
 * button), for every Group that has one, in a single action.
 *
 * BATCHED BY (targetPlanId, targetTermId), not by Group: several Groups
 * landing on the same successor plan and Term share one apply pass, the same
 * reuse `POST /api/offering-plan-apply/:id`'s own `groupIds` bulk shape
 * relies on. For the same reason, each batch is SEQUENTIAL across its
 * Groups (`applyOfferingPlanItems` reads "what already exists" then writes,
 * so a concurrent second Group in the same batch would race that read).
 *
 * A GROUP CAN HAVE MORE THAN ONE ELIGIBLE ADVANCE (on more than one plan at
 * once): each is its own entry here, exactly matching what clicking
 * "Advance" on each of that Group's rows individually would do.
 *
 * A batch failing (the successor plan has no items yet, or a template is
 * missing a kind/title) does not stop the others: reported in `failed`,
 * naming every Group it would have covered, rather than one bad plan taking
 * down every Group's advance in the same request.
 */
export default defineEventHandler(async (event) => withRequestTenant(event, async (tx, identity) => {
    await requirePermission(event, tx, 'offering_plan.apply');

    const applications = await deriveGroupPlanApplications(tx, identity.tenantId);

    const eligible: {
        groupId: string;
        fromPlanName: string;
        advance: { planId: string; planName: string; termId: string; termName: string };
    }[] = [];

    for (const [groupId, rows] of applications) {
        for (const row of rows) {
            if (row.advance) {
                eligible.push({ groupId, fromPlanName: row.planName, advance: row.advance });
            }
        }
    }

    if (!eligible.length) {
        return { advanced: [] as AdvancedGroup[], failed: [] as FailedBatch[] };
    }

    const groups = await tx.group.findMany({
        where: { id: { in: [...new Set(eligible.map((e) => e.groupId))] }, tenantId: identity.tenantId },
        select: { id: true, name: true },
    });
    const groupNameOf = new Map(groups.map((g) => [g.id, g.name]));

    interface Batch {
        planId: string;
        planName: string;
        termId: string;
        termName: string;
        entries: typeof eligible;
    }

    const batches = new Map<string, Batch>();

    for (const entry of eligible) {
        const key = `${entry.advance.planId}:${entry.advance.termId}`;
        const batch = batches.get(key) ?? {
            planId: entry.advance.planId,
            planName: entry.advance.planName,
            termId: entry.advance.termId,
            termName: entry.advance.termName,
            entries: [],
        };

        batch.entries.push(entry);
        batches.set(key, batch);
    }

    return mapDbErrors(async () => {
        const advanced: AdvancedGroup[] = [];
        const failed: FailedBatch[] = [];

        for (const batch of batches.values()) {
            const groupIds = batch.entries.map((e) => e.groupId);

            const plan = await tx.offeringPlan.findFirst({
                where: { id: batch.planId, tenantId: identity.tenantId },
                include: { items: { orderBy: { position: 'asc' }, include: { template: true } } },
            });

            if (!plan || !plan.items.length) {
                failed.push({
                    planId: batch.planId,
                    planName: batch.planName,
                    termId: batch.termId,
                    termName: batch.termName,
                    groupIds,
                    reason: plan ? 'This plan has no offerings to apply yet.' : 'Plan no longer exists.',
                });
                continue;
            }

            const existing = await existingOfferingsByTemplate(tx, {
                tenantId: identity.tenantId,
                termId: batch.termId,
                templateIds: plan.items.map((item) => item.templateId),
            });
            const incomplete = incompleteTemplateNames(plan.items.filter((item) => !existing.has(item.templateId)));

            if (incomplete.length) {
                failed.push({
                    planId: batch.planId,
                    planName: batch.planName,
                    termId: batch.termId,
                    termName: batch.termName,
                    groupIds,
                    reason: `These templates are missing a kind or a title, and cannot seed an offering yet: ${incomplete.join(', ')}.`,
                });
                continue;
            }

            for (const entry of batch.entries) {
                const offerings = await applyOfferingPlanItems(tx, {
                    tenantId: identity.tenantId,
                    termId: batch.termId,
                    groupId: entry.groupId,
                    items: plan.items,
                });

                advanced.push({
                    groupId: entry.groupId,
                    groupName: groupNameOf.get(entry.groupId) ?? 'Unknown group',
                    fromPlanName: entry.fromPlanName,
                    toPlanId: batch.planId,
                    toPlanName: batch.planName,
                    toTermName: batch.termName,
                    offerings: offerings.length,
                });
            }
        }

        return { advanced, failed };
    });
}));
