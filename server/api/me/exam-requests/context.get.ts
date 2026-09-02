import { requirePermission } from '../../../utils/requirePermission';
import { withRequestTenant } from '../../../utils/tenantDb';

defineRouteMeta({
    openAPI: {
        tags: ['Exam requests'],
        summary: 'Reference data for the "my exams" request form',
        description: 'The modules the caller leads, the exam-typed session kinds, every TimeGrid, '
            + 'every Term and every calendar period: everything /my/exams needs to draw its form '
            + 'and classify weeks, scoped to exam.request_own alone. See this file\'s own comment '
            + '(issue #108) for why it exists instead of the page calling the generic list routes.',
        responses: {
            200: { description: 'The reference data described above.' },
            403: { description: 'Caller lacks exam.request_own.' },
        },
    },
});

/**
 * Reference data `/my/exams` needs to draw its form, scoped to
 * `exam.request_own` alone, never `offering.read` / `session_kind.read` /
 * `time_grid.read` / `term.read`.
 *
 * ISSUE #108. The page used to assemble this same data from the generic
 * `/api/offerings`, `/api/session-kinds`, `/api/time-grids`, `/api/terms` and
 * `/api/calendar-periods` routes, each gated on its own institution-wide
 * `<resource>.read`. Its nav entry and page middleware gate on
 * `exam.request_own` alone (a lecturer must not need the authority to
 * enumerate the whole staff directory just to ask for an exam, the same
 * reasoning `/api/me/offerings` and `/api/schedule/context` already state),
 * so a lecturer holding exactly that one permission hit a 403 on the first of
 * five endpoints in the page's `Promise.all` and the page rendered BLANK with
 * no explanation: CLAUDE.md's own "a page must not depend on permissions its
 * own gate doesn't imply" failure, and the "one missing permission inside a
 * `Promise.all` blanks the whole page" shape it names explicitly.
 *
 * Offerings are narrowed to the ones the caller LEADS (`OfferingLecturer`),
 * the same rule `/api/me/offerings` follows; the write endpoint
 * (`POST /api/me/exam-requests`) re-checks lecturer status itself via
 * `assertLeadsOffering`, so a stale row here changes nothing about what can
 * actually be requested. Kinds, grids, terms and calendar periods are
 * tenant-wide reference config with nothing person-specific in them: the
 * whole list is what every caller needs to populate a select or classify a
 * week, the same as `/api/schedule/context`'s own frame.
 */
export default defineEventHandler(async (event) => withRequestTenant(event, async (tx, identity) => {
    await requirePermission(event, tx, 'exam.request_own');

    // Sequential: `tx` is one shared connection; concurrent queries on it
    // trip pg's deprecated overlapping-query warning.
    const offerings = identity.actorPersonId
        ? await tx.offering.findMany({
            where: {
                tenantId: identity.tenantId,
                lecturers: { some: { personId: identity.actorPersonId } },
            },
            select: { id: true, title: true, code: true, termId: true },
            orderBy: { title: 'asc' },
        })
        : [];
    const kinds = await tx.sessionKind.findMany({
        where: { tenantId: identity.tenantId },
        select: { id: true, name: true, type: true },
        orderBy: { name: 'asc' },
    });
    const grids = await tx.timeGrid.findMany({
        where: { tenantId: identity.tenantId },
        include: { breaks: true },
        orderBy: { name: 'asc' },
    });
    const terms = await tx.term.findMany({
        where: { tenantId: identity.tenantId },
        select: { id: true, name: true, startDate: true, endDate: true },
        orderBy: { startDate: 'asc' },
    });
    const periods = await tx.calendarPeriod.findMany({
        where: { tenantId: identity.tenantId },
        select: { termId: true, kind: true, startDate: true, endDate: true },
        orderBy: { startDate: 'asc' },
    });

    return { offerings, kinds, grids, terms, periods };
}));
