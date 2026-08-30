import type { Tx } from './tenantDb';

/**
 * What a combined Group's membership would be if it were regenerated now, and
 * how far it has drifted from what it is.
 *
 * WHY DRIFT IS COMPUTED RATHER THAN WATCHED. Membership is materialised on
 * purpose: a live union would keep a timetable's attendee set moving between
 * solves with nothing in the event log saying why. The cost of that choice is
 * that the group goes stale, and the only thing that makes stale acceptable is
 * being able to SEE it — so this is the other half of the decision, not a
 * convenience on top of it.
 *
 * PURE-ISH AND SEPARATE FROM THE ROUTE because two callers need the same
 * answer: the drift readout and the regenerate that acts on it. Computing it
 * twice is how the number on screen and the number applied come to disagree.
 */
export interface SourceDrift {
    /** Person ids the sources hold between them, deduplicated. */
    expected: string[];
    /** Person ids the combined group currently holds. */
    current: string[];
    /** In the sources, not yet in the group. */
    added: string[];
    /** In the group, no longer in any source. */
    removed: string[];
    sourceCount: number;
    generatedAt: Date | null;
}

export async function sourceDrift(tx: Tx, tenantId: string, groupId: string): Promise<SourceDrift> {
    const group = await tx.group.findFirst({
        where: { id: groupId, tenantId },
        select: {
            membersGeneratedAt: true,
            sources: { select: { sourceGroupId: true } },
            memberships: { select: { personId: true } },
        },
    });

    if (!group) {
        throw createError({ statusCode: 404, statusMessage: 'Group not found.' });
    }

    const sourceIds = group.sources.map((s) => s.sourceGroupId);

    /*
     * DIRECT MEMBERS OF THE NAMED GROUPS, not their subtrees.
     *
     * A source is picked by hand and means exactly itself. Expanding to
     * descendants would make "draw from dit22 S1 Management" quietly also mean
     * every group under it — usually the same set, and silently not when
     * somebody adds a child. The narrower reading is the one a person can
     * predict from the name they picked.
     */
    const members = sourceIds.length
        ? await tx.membership.findMany({
            where: { tenantId, groupId: { in: sourceIds } },
            select: { personId: true },
        })
        : [];

    const expected = [...new Set(members.map((m) => m.personId))];
    const current = group.memberships.map((m) => m.personId);
    const currentSet = new Set(current);
    const expectedSet = new Set(expected);

    return {
        expected,
        current,
        added: expected.filter((id) => !currentSet.has(id)),
        removed: current.filter((id) => !expectedSet.has(id)),
        sourceCount: sourceIds.length,
        generatedAt: group.membersGeneratedAt,
    };
}
