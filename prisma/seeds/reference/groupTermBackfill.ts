import type { PrismaClient } from '@prisma/client';

/**
 * Derive `group_term` scope from how Groups are ALREADY used.
 *
 * WHY THIS IS A SEED AND NOT PART OF THE MIGRATION
 *
 * Migrations create no rows (CLAUDE.md). More than a convention here: the
 * derivation is a judgement about existing data, and a judgement belongs
 * somewhere it can be corrected and re-run rather than frozen into DDL history.
 *
 * WHAT IT DERIVES, AND WHAT IT DELIBERATELY DOES NOT
 *
 * A Group is scoped to a Term when it is ALREADY attached to something in that
 * Term — an Offering (`offering_group`) or a Session (`session_group`). Both
 * sources, because a Session can carry a Group its Offering does not (a one-off
 * added to a single occurrence), and scoping from Offerings alone would then
 * narrow a Group out of a Term it is visibly used in.
 *
 * ANCESTORS ARE NOT AUTO-SCOPED. "IT Security" is the parent of a cohort
 * scheduled this Term, but a degree programme is not Term-bound — it persists
 * across all of them and is never directly scheduled. Walking the closure
 * upward would pin the programme to whichever Terms its cohorts happen to
 * occupy, which is both wrong and self-narrowing over time. It stays unscoped,
 * which under the fail-open rule means available everywhere — exactly right.
 *
 * IDEMPOTENT, AND NON-DESTRUCTIVE. `skipDuplicates` on the insert and no
 * deletes: re-running adds only what is missing. It never removes a scope
 * somebody set by hand, because "this Group is no longer used in that Term" is
 * not evidence that the tenant wants it unavailable there — they may be about
 * to build next Term's timetable.
 *
 * Consequently it is a NO-OP on a fresh database, and safe on every deploy.
 */
export interface GroupTermBackfillResult {
    created: number;
    /** Groups that gained at least one scope row. */
    scopedGroups: number;
    /** Groups left with no scope at all — i.e. still available in every Term. */
    universalGroups: number;
}

export async function backfillGroupTerms(prisma: PrismaClient): Promise<GroupTermBackfillResult> {
    /**
     * One statement rather than read-then-write: the derivation is a set
     * operation, and doing it in SQL means it cannot drift between the rows it
     * reads and the rows it writes.
     *
     * `tenant_id` is taken from the GROUP, not from the Offering or Session.
     * They are necessarily the same tenant — every one of these tables is
     * tenant-scoped and joined by id — but taking it from the group makes the
     * row's tenant match the entity the scope is ABOUT, which is what the RLS
     * policy on `group_term` checks.
     */
    const created = await prisma.$executeRaw`
        INSERT INTO group_term (group_id, term_id, tenant_id)
        SELECT DISTINCT g.id, t.term_id, g.tenant_id
          FROM "group" g
          JOIN (
                SELECT og.group_id, o.term_id
                  FROM offering_group og
                  JOIN offering o ON o.id = og.offering_id
                 UNION
                SELECT sg.group_id, s.term_id
                  FROM session_group sg
                  JOIN session s ON s.id = sg.session_id
               ) t ON t.group_id = g.id
        ON CONFLICT (group_id, term_id) DO NOTHING
    `;

    const [scoped, total] = await Promise.all([
        prisma.groupTerm.findMany({ select: { groupId: true }, distinct: ['groupId'] }),
        prisma.group.count(),
    ]);

    return {
        created,
        scopedGroups: scoped.length,
        universalGroups: total - scoped.length,
    };
}
