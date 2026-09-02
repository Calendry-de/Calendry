import { isoDate, localNow, termPosition } from '../../../shared/academicCalendar';
import { requirePermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

/**
 * WHICH TERM IT IS, AND WHICH WEEK OF IT, resolved in the tenant's own zone.
 *
 * WHY THIS EXISTS. `/dashboard` states counts that are all implicitly about a
 * term, and named none of them: a reader got numbers with no calendar around
 * them, which is the "date range clearly labelled" gap a dashboard cannot be
 * read without. This is that label, and it is one row plus one arithmetic
 * rather than a whole schedule payload.
 *
 * "CURRENT" MEANS THE SAME TERM `/api/schedule/context` OPENS ON: the most
 * recent by `startDate`, which is `RESOURCES['terms']`' own ordering and
 * therefore what the schedule's own term picker defaults to. NOT "the term
 * containing today", tempting as that is. Two surfaces naming different terms
 * "current" is the drift this repo keeps paying for, and the schedule is the
 * authority on which term a person is looking at; if it opens on next
 * autumn's term because that is the most recently authored one, the dashboard
 * has to say so rather than quietly disagree. `phase` is what carries the
 * honest reading of a term that has not started.
 *
 * WHY THE SERVER COMPUTES THE WEEK. The week depends on `Tenant.timezone`, and
 * `/api/schedule/context` is documented as THE ONE place a client learns that
 * zone (it needs it for the live now-indicator). A dashboard header line is not
 * a reason to publish it a second time, so the arithmetic happens where the
 * zone already lives and only its answer travels. `termPosition` is shared with
 * nothing else yet, but it is in `shared/` beside `weekIndexOf` because
 * `jumpToToday` resolves today the same way and the two must not drift.
 *
 * NO `termId` PARAMETER, deliberately: a route that answered "which week is it
 * in the term I name" would be a second, weaker copy of this arithmetic for
 * callers who already have the term. This answers the one question that needs
 * the server, which is which term and what today is.
 *
 * NOT AT `/api/terms/current`, AND THAT IS THE ONE THING NOT TO "TIDY UP".
 * `terms` is in `CRUD_RESOURCES`, so `/api/terms` and `/api/terms/{id}` are
 * served by `server/api/[resource]/`. Creating a LITERAL `server/api/terms/`
 * directory hands Nitro a static segment, which wins over the `[resource]`
 * parameter for everything beneath it INCLUDING PATHS THE LITERAL BRANCH HAS
 * NO HANDLER FOR: with no `terms/index.post.ts`, `POST /api/terms` 404s rather
 * than falling back to the generic create. It was written that way first and
 * broke exactly that, caught by `tests/offering-plan.test.ts`.
 *
 * `server/utils/resources.ts` already records this hazard for `offering-plans`
 * (whose sub-resources live at `offering-plan-items/` and `offering-plan-apply/`
 * for the same reason), and `group-sources` sits beside `groups` rather than
 * under it. This route follows that precedent: its own top-level path, which
 * shadows nothing. The alternative, a passthrough `terms/index.post.ts`, would
 * be a second implementation of the generic create, which is the drift CLAUDE.md
 * forbids outright.
 */
defineRouteMeta({
    openAPI: {
        tags: ['Resources'],
        summary: 'The current Term and which week of it today is',
        description: 'Names the term the schedule opens on (the most recent by startDate, the same default GET /api/schedule/context resolves) and places today inside it. Requires term.read, the same key as GET /api/terms. week is 1-based and Monday-anchored, matching the schedule\'s own Today button: week 1 begins on the Monday on or before startDate, so a date in that Monday\'s week reads as DURING week 1 even if the term\'s start date has not arrived. Read week only alongside phase, which is BEFORE (week clamped to 1), DURING or AFTER (week clamped to the last). A tenant with no Term at all answers { "term": null } and nothing else: no term configured and a request that failed are different facts, and this is the first.',
        responses: {
            200: {
                description: 'The resolved Term and today\'s position in it, or { term: null } when the tenant has authored none.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['term'],
                            properties: {
                                term: {
                                    nullable: true,
                                    type: 'object',
                                    required: ['id', 'name', 'startDate', 'endDate'],
                                    properties: {
                                        id: { type: 'string' },
                                        name: { type: 'string' },
                                        startDate: { type: 'string', format: 'date', description: 'ISO-8601 date only. A term boundary is a calendar fact about the institution, never an instant shifted by whoever is looking at it.' },
                                        endDate: { type: 'string', format: 'date' },
                                    },
                                },
                                phase: { type: 'string', enum: ['BEFORE', 'DURING', 'AFTER'], description: 'Where today falls relative to the term, in the tenant\'s timezone. Absent when term is null.' },
                                week: { type: 'integer', minimum: 1, description: '1-based term week of today, clamped into the term. Absent when term is null.' },
                                totalWeeks: { type: 'integer', minimum: 1, description: 'Monday-anchored weeks the term spans. Absent when term is null.' },
                            },
                        },
                    },
                },
            },
            403: { description: 'Caller lacks term.read.' },
        },
    },
});

export default defineEventHandler(async (event) => withRequestTenant(event, async (tx, identity) => {
    await requirePermission(event, tx, 'term.read');

    // Sequential, not `Promise.all`: `tx` is one shared connection, and
    // concurrent queries on it trip pg's overlapping-query warning, the same
    // reason `/api/schedule/context` fetches its reference rows in sequence.
    const term = await tx.term.findFirst({
        where: { tenantId: identity.tenantId },
        orderBy: { startDate: 'desc' },
        select: { id: true, name: true, startDate: true, endDate: true },
    });

    /*
     * A DISCRIMINATED SHAPE rather than a term with three optional siblings:
     * `phase`/`week`/`totalWeeks` are meaningless without a term, and
     * CLAUDE.md prefers a union over optional-field soup precisely so a
     * consumer cannot read a week that describes nothing. A fresh tenant with
     * no Term hits this, and the dashboard says so rather than falling back to
     * the same silence a failed request would produce.
     */
    if (!term) {
        return { term: null };
    }

    const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: identity.tenantId },
        select: { timezone: true },
    });

    // TENANT-LOCAL, never `new Date()` alone: which calendar day it is decides
    // which week this reports, and CLAUDE.md's rule is that a viewer's own zone
    // is display-only and never resolves a grid question.
    const today = localNow(new Date(), tenant.timezone).date;

    return {
        term: {
            id: term.id,
            name: term.name,
            startDate: isoDate(term.startDate),
            endDate: isoDate(term.endDate),
        },
        ...termPosition(term.startDate, term.endDate, today),
    };
}));
