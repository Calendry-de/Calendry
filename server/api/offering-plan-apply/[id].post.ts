import { z } from 'zod';
import { mapDbErrors } from '../../utils/dbErrors';
import { applyOfferingPlanItems, existingOfferingsByTemplate, incompleteTemplateNames } from '../../utils/offeringPlans';
import { requirePermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

const bodySchema = z.object({
    termId: z.string().min(1),
    groupId: z.string().min(1).optional(),
    /** The bulk form; see the handler's own comment for why it is a separate field rather than `groupId` accepting an array. */
    groupIds: z.array(z.string().min(1)).min(1).max(100).optional(),
}).refine((body) => Boolean(body.groupId) !== Boolean(body.groupIds), {
    message: 'Provide exactly one of groupId or groupIds.',
});

defineRouteMeta({
    openAPI: {
        tags: ['Curriculum plans'],
        summary: 'Apply a curriculum plan to one or more Groups, for one Term',
        description: 'Gives the Group(s) every Offering in the plan for the given Term: creating whichever ones do not exist yet and attaching each Group to whichever already do (reuse is keyed on term + createdFromTemplateId, not on the plan, so two Groups taking the same subject in the same Term share one Offering). Idempotent: re-applying the same plan to a Group that already has it changes nothing. Provide exactly one of groupId (single-Group shape, responds { offerings }) or groupIds (bulk shape, responds { results: [...] }). All-or-nothing across every check, for every Group named, before writing anything.',
        parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Curriculum plan id.' },
        ],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['termId'],
                        properties: {
                            termId: { type: 'string' },
                            groupId: { type: 'string', description: 'Single-Group shape. Exactly one of groupId/groupIds.' },
                            groupIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 100, description: 'Bulk shape. Exactly one of groupId/groupIds.' },
                        },
                    },
                },
            },
        },
        responses: {
            200: { description: 'groupId sent: { offerings: [...] }. groupIds sent: { results: [{ groupId, offerings }] }.' },
            403: { description: 'Caller lacks offering_plan.apply.' },
            404: { description: 'Plan, Term, or one or more Groups not found in this tenant.' },
            422: { description: 'The plan has no items yet, or one or more of its templates is missing a kind or a title.' },
        },
    },
});

/**
 * Gives one or more Groups every Offering in a curriculum plan, for one Term:
 * creating whichever ones do not exist yet and ATTACHING each Group to
 * whichever already do, rather than ever making a second "Math" for a Term
 * that already has one.
 *
 * TWO SEPARATE FIELDS, NOT ONE ARRAY-OR-SCALAR. `groupId` is the original,
 * single-Group shape (still what a Group's own "Apply a plan" panel sends,
 * and still the shape that responds with a bare `{ offerings }`, so no
 * existing caller had to change); `groupIds` is the "roll this out" bulk
 * shape a Plan's own page uses, which responds `{ results: [...] }` because
 * a bulk caller needs to know WHICH Group each batch of offerings belongs
 * to. Letting `groupId` silently accept an array would have made both
 * response shapes live behind one field, indistinguishable without also
 * inspecting what was sent.
 *
 * REUSE IS KEYED ON (term, `createdFromTemplateId`), NOT ON THE PLAN. Two
 * Jahrgänge taking the same subject in the same Term is exactly the shape
 * TAXONOMY.md already gives multiple Groups on one Offering: N independent
 * parallel Session series, one per Group, so the second Jahrgang's apply
 * finds the first's Offering and joins it instead of duplicating it. This
 * also makes applying IDEMPOTENT: re-running the same plan against the same
 * Group in the same Term finds every Offering already has that Group and
 * changes nothing, so there is no "confirm before duplicating" step to ask
 * for; repeating the action, or rolling it out to a Group that already has
 * it alongside ones that don't, is always safe.
 *
 * READS TEMPLATES FRESH, AT APPLY TIME, for whichever items still need
 * CREATING. See `applyOfferingPlanItems`, the actual mechanics, shared with
 * `scripts/seed-demo-schedule.ts` so the demo curriculum is built through the
 * same path a tenant would use.
 *
 * ALL-OR-NOTHING ON BOTH CHECKS, ACROSS EVERY GROUP, before writing anything:
 * a template missing `kindId` or `title` cannot become a valid Offering, and
 * an unknown Group id is refused the same way an unknown Term id already
 * is. A bulk apply that partly failed, three Groups placed, a fourth 404s,
 * would leave the tenant guessing which ones actually happened.
 */
export default defineEventHandler(async (event) => {
    const planId = getRouterParam(event, 'id');
    const body = await readValidatedBody(event, bodySchema.parse);
    const groupIds = body.groupIds ?? [body.groupId!];

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'offering_plan.apply');

        const plan = await tx.offeringPlan.findFirst({
            where: { id: planId, tenantId: identity.tenantId },
            include: {
                items: {
                    orderBy: { position: 'asc' },
                    include: { template: true },
                },
            },
        });

        if (!plan) {
            throw createError({ statusCode: 404, statusMessage: 'Plan not found.' });
        }

        if (!plan.items.length) {
            throw createError({ statusCode: 422, statusMessage: 'This plan has no offerings to apply yet.' });
        }

        const term = await tx.term.findFirst({
            where: { id: body.termId, tenantId: identity.tenantId },
            select: { id: true },
        });

        if (!term) {
            throw createError({ statusCode: 404, statusMessage: 'Term not found.' });
        }

        const groups = await tx.group.findMany({
            where: { id: { in: groupIds }, tenantId: identity.tenantId },
            select: { id: true },
        });

        if (groups.length !== groupIds.length) {
            const found = new Set(groups.map((g) => g.id));

            throw createError({
                statusCode: 404,
                statusMessage: `Group(s) not found: ${groupIds.filter((id) => !found.has(id)).join(', ')}.`,
            });
        }

        const existing = await existingOfferingsByTemplate(tx, {
            tenantId: identity.tenantId,
            termId: body.termId,
            templateIds: plan.items.map((item) => item.templateId),
        });

        const incomplete = incompleteTemplateNames(plan.items.filter((item) => !existing.has(item.templateId)));

        if (incomplete.length) {
            throw createError({
                statusCode: 422,
                statusMessage: `These templates are missing a kind or a title, and cannot seed an offering yet: ${incomplete.join(', ')}.`,
                data: { incompleteTemplates: incomplete },
            });
        }

        return mapDbErrors(async () => {
            const results = [];

            // Sequential, not `Promise.all`: `applyOfferingPlanItems` reads
            // "what already exists" then writes, so the second Group in a
            // bulk apply must see the first Group's freshly-created
            // Offerings; running them concurrently would race that read and
            // recreate the same Offering twice.
            for (const groupId of groupIds) {
                const offerings = await applyOfferingPlanItems(tx, {
                    tenantId: identity.tenantId,
                    termId: body.termId,
                    groupId,
                    items: plan.items,
                });

                results.push({ groupId, offerings });
            }

            return body.groupIds ? { results } : { offerings: results[0]!.offerings };
        });
    });
});
