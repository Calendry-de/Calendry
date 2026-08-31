import { requirePermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

interface Application {
    planId: string;
    planName: string;
    termId: string;
    termName: string;
    /** Present only when the plan names a successor AND a later Term exists to move into. */
    advance: { planId: string; planName: string; termId: string; termName: string } | null;
}

/**
 * Every curriculum plan this Group already has offerings from, with the
 * "advance" target for each — the ONE query that answers both "what does
 * this Group already have" (so applying again isn't a mystery) and "what's
 * next" (so moving it forward needs no picker). A separate top-level
 * resource rather than `groups/[id]/...`, the same reason
 * `offering-plan-items` sits beside `offering-plans` instead of under it —
 * see that file's own comment on the routing shadow this avoids.
 *
 * DERIVED, NOT STORED. Nothing records "this apply came from this plan" —
 * `Offering.createdFromTemplateId` is the only trail, so an application is
 * reconstructed by joining back through `OfferingPlanItem`. A template
 * belonging to more than one plan (nothing forbids it) surfaces as more than
 * one application for the same Offering, which is the honest answer: this
 * Group's timetable genuinely came from both.
 */
export default defineEventHandler(async (event) => {
    const groupId = getRouterParam(event, 'id');

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'offering_plan.apply');

        const group = await tx.group.findFirst({
            where: { id: groupId, tenantId: identity.tenantId },
            select: { id: true },
        });

        if (!group) {
            throw createError({ statusCode: 404, statusMessage: 'Not found.' });
        }

        const offerings = await tx.offering.findMany({
            where: {
                tenantId: identity.tenantId,
                groups: { some: { groupId } },
                createdFromTemplateId: { not: null },
            },
            select: {
                termId: true,
                createdFromTemplateId: true,
                term: { select: { id: true, name: true, startDate: true } },
            },
        });

        if (!offerings.length) {
            return [] as Application[];
        }

        const templateIds = [...new Set(offerings.map((o) => o.createdFromTemplateId!))];

        const items = await tx.offeringPlanItem.findMany({
            where: { tenantId: identity.tenantId, templateId: { in: templateIds } },
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

        const plansByTemplate = new Map<string, typeof items[number]['plan'][]>();

        for (const item of items) {
            const bucket = plansByTemplate.get(item.templateId) ?? [];

            bucket.push(item.plan);
            plansByTemplate.set(item.templateId, bucket);
        }

        // All Terms once, ordered — the "next Term after this one" lookup
        // below is a scan of this list rather than a query per application.
        const terms = await tx.term.findMany({
            where: { tenantId: identity.tenantId },
            select: { id: true, name: true, startDate: true },
            orderBy: { startDate: 'asc' },
        });

        const seen = new Set<string>();
        const applications: (Application & { termStart: Date })[] = [];

        for (const offering of offerings) {
            const plans = plansByTemplate.get(offering.createdFromTemplateId!) ?? [];

            for (const plan of plans) {
                const key = `${plan.id}:${offering.termId}`;

                if (seen.has(key)) {
                    continue;
                }

                seen.add(key);

                const nextTerm = terms.find((term) => term.startDate > offering.term.startDate);

                applications.push({
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

        // Chronological, so "what's next" always reads as the row after the
        // group's most recent Term rather than requiring the reader to sort
        // it out from term names.
        applications.sort((a, b) => a.termStart.getTime() - b.termStart.getTime());

        return applications.map(({ termStart: _termStart, ...application }) => application);
    });
});
