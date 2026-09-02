<template>
    <CommonAppShell
        :description="t('managePages.examReviews.description')"
        :title="t('managePages.examReviews.pageTitle')"
    >
        <!--
            `<i18n-t>` so the emphasised phrase stays inside ONE translatable
            sentence: it is grammar, not decoration, and German would not leave
            it at the same point in the clause.
        -->
        <i18n-t
            class="intro"
            keypath="managePages.examReviews.intro"
            scope="global"
            tag="p"
        >
            <template #locked>
                <strong>{{ t('managePages.examReviews.introLocked') }}</strong>
            </template>
        </i18n-t>

        <p
            v-if="error"
            class="note note--error"
            role="alert"
        >{{ error }}</p>

        <!--
            WARN, DON'T BLOCK: the approval above already went through. The
            teaching-plan fact itself is now a per-row column (issue #101),
            visible before deciding; this is what is left needing a one-time
            message: a preferred room too small for the exam sitting, known
            only once the approval has actually run the capacity check.
        -->
        <p
            v-if="approveWarning"
            class="note note--warn"
            role="status"
        >{{ approveWarning }}</p>

        <section
            v-for="group in groups"
            :key="group.status"
            class="queue"
        >
            <h2 class="queue_head">
                {{ group.label }}
                <span class="queue_count">{{ group.rows.length }}</span>
            </h2>

            <p
                v-if="!group.rows.length"
                class="queue_empty"
            >{{ group.empty }}</p>

            <ul
                v-else
                class="queue_rows"
            >
                <li
                    v-for="row in group.rows"
                    :key="row.id"
                    class="row"
                >
                    <div class="row_main">
                        <strong>{{ row.offering.title }}</strong>
                        <!--
                            ONE plural message for the whole line: "block{s}"
                            was a word split across an expression, so no part
                            of it could be keyed, and German pluralises the
                            stem. `kind` and `term` are tenant-named and pass
                            through untranslated.
                        -->
                        <span class="row_meta">{{ t('managePages.examReviews.rowMeta', {
                            kind: row.kind.name,
                            term: row.term.name,
                            week: row.termWeek,
                            day: weekdayName(row.dayOfWeek),
                            block: row.blockIndex + 1,
                            count: row.durationBlocks,
                        }) }}</span>
                        <!--
                            ONE MESSAGE PER SHAPE rather than a bare " · prefers
                            {room}" fragment appended: the clause carries a verb,
                            so it is grammar, not punctuation
                            (i18n/CONVENTIONS.md § "Assembled sentences").
                        -->
                        <span class="row_meta">{{ row.room
                            ? t('managePages.examReviews.requestedByWithRoom', {
                                person: personName(row.requestedBy),
                                room: row.room.name,
                            })
                            : t('managePages.examReviews.requestedBy', { person: personName(row.requestedBy) }) }}</span>
                        <!--
                            The reviewer's most useful single fact, and one the
                            request itself does not carry: an exam outside the
                            declared period is a legitimate ask (a Nachklausur
                            usually is) and also the one worth looking at twice.
                        -->
                        <span
                            class="row_meta"
                            :class="{ 'row_meta--warn': row.weekKind !== 'EXAM' }"
                        >{{ row.weekKind === 'EXAM'
                            ? t('managePages.examReviews.insideExamPeriod')
                            : t('managePages.examReviews.outsideExamPeriod') }}</span>

                        <!--
                            ISSUE #101, the fact itself rather than a toast: a
                            module's teaching-plan completeness is state to
                            check BEFORE deciding, not something learned only
                            as a side effect of having already approved.
                        -->
                        <span
                            v-if="!row.teachingComplete.complete"
                            class="row_meta row_meta--warn"
                        >{{ t('managePages.examReviews.teachingPlanRow', {
                            placed: row.teachingComplete.placedCount,
                            required: row.teachingComplete.requiredCount,
                        }) }}</span>

                        <span
                            v-if="row.note"
                            class="row_note"
                        >{{ t('managePages.examReviews.note', { note: row.note }) }}</span>
                    </div>

                    <div
                        v-if="row.status === 'PENDING'"
                        class="row_actions"
                    >
                        <CommonButton
                            :disabled="busy === row.id"
                            type="primary"
                            @click="decide(row.id, 'approve')"
                        >{{ t('managePages.examReviews.approve') }}</CommonButton>
                        <CommonButton
                            :disabled="busy === row.id"
                            type="secondary"
                            @click="decide(row.id, 'reject')"
                        >{{ t('managePages.examReviews.reject') }}</CommonButton>
                    </div>
                    <!--
                        ONE MESSAGE PER OUTCOME, verb and preposition inside it:
                        "{status} by {person}" assembled in the template is a
                        clause German reorders.
                    -->
                    <span
                        v-else
                        class="row_status"
                    >{{ row.status === 'APPROVED'
                        ? t('managePages.examReviews.decidedApproved', { person: personName(row.decidedBy) })
                        : t('managePages.examReviews.decidedRejected', { person: personName(row.decidedBy) }) }}</span>
                </li>
            </ul>
        </section>
    </CommonAppShell>
</template>

<script setup lang="ts">
import { weekdayName } from '~/composables/schedule';
import { useT } from '~/composables/i18n';
import { useSession } from '~/composables/session';

/**
 * The staff half of the exam flow.
 *
 * SPLIT BY STATUS RATHER THAN FILTERED, because the decided rows are the
 * evidence the queue is working. A page showing only what is pending looks
 * identical whether nothing has been asked for and whether everything has
 * already been handled.
 */
definePageMeta({
    /*
     * Gated INLINE, not through the `manage` middleware: that one resolves the
     * route segment against the entity registry and 404s anything it does not
     * recognise, and this is not a registry entity: it has no list, no row
     * form and no `/api/exams` resource behind it. Same reasoning the
     * unavailability review page already carries.
     */
    middleware: [
        () => {
            const held = new Set(useSession().value?.permissions ?? []);

            if (!held.has('exam.review')) {
                return abortNavigation(createError({
                    statusCode: 403,
                    message: 'Reviewing exam requests needs exam.review.',
                }));
            }
        },
    ],
});
const { t } = useT();

useHead(() => ({ title: t('managePages.examReviews.pageTitle') }));

interface Named { id: string; givenName: string; familyName: string }

interface ReviewRow {
    id: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    termWeek: number;
    dayOfWeek: number;
    blockIndex: number;
    durationBlocks: number;
    note: string | null;
    offering: { id: string; title: string; code: string | null };
    kind: { id: string; name: string };
    term: { id: string; name: string };
    room: { id: string; name: string; code: string } | null;
    /** Resolved per Term by the server, so both exam pages agree. */
    weekKind: string;
    /** Issue #101: the module's own teaching plan, not this request's placement. */
    teachingComplete: { complete: boolean; placedCount: number; requiredCount: number };
    requestedBy: Named | null;
    decidedBy: Named | null;
}

const request = useRequestFetch();

const { data, refresh } = await useAsyncData(
    'manage:exam-reviews',
    () => request<{ rows: ReviewRow[] }>('/api/exam-requests'),
);

const rows = computed(() => data.value?.rows ?? []);

const groups = computed(() => [
    {
        status: 'PENDING',
        label: t('managePages.examReviews.pendingHead'),
        empty: t('managePages.examReviews.pendingEmpty'),
        rows: rows.value.filter((r) => r.status === 'PENDING'),
    },
    {
        status: 'DECIDED',
        label: t('managePages.examReviews.decidedHead'),
        empty: t('managePages.examReviews.decidedEmpty'),
        rows: rows.value.filter((r) => r.status !== 'PENDING'),
    },
]);

/*
 * An unresolvable person shows as a word rather than an empty gap: the pointer
 * is ON DELETE SET NULL, so a decision outlives the administrator who made it
 * and the row must still read as a decision.
 */
function personName(person: Named | null): string {
    return person
        ? `${person.givenName} ${person.familyName}`
        : t('managePages.examReviews.personUnknown');
}

const busy = ref('');
const error = ref('');
const approveWarning = ref('');

async function decide(id: string, action: 'approve' | 'reject') {
    busy.value = id;
    error.value = '';
    approveWarning.value = '';

    try {
        const result = await request<{
            examCapacity?: { checked: boolean; roomCapacity: number | null; requiredCapacity: number | null; sufficient: boolean };
        }>(`/api/exam-requests/${id}/${action}`, { method: 'POST', body: {} });

        // A too-small preferred room, same warn-and-allow shape as a room
        // clash: reported here, never a reason approval was refused. Unlike
        // teaching-plan completeness (now a per-row fact, above), this is
        // only known once the approval has actually run the capacity check.
        if (action === 'approve' && result.examCapacity?.checked && !result.examCapacity.sufficient) {
            approveWarning.value = t('managePages.examReviews.capacityWarning', {
                roomCapacity: result.examCapacity.roomCapacity,
                requiredCapacity: result.examCapacity.requiredCapacity,
            });
        }

        await refresh();
    } catch (cause) {
        // The server's own sentence: approving can fail because the grid changed
        // under a pending request, and "could not save" would hide that.
        error.value = serverErrorMessage(cause)
            ?? t('managePages.examReviews.decisionError');
    } finally {
        busy.value = '';
    }
}
</script>

<style scoped lang="scss">
.intro {
    max-width: 68ch;
    margin: 0 0 var(--space-6);

    font-size: var(--font-size-md);
    line-height: 1.6;
    color: $content5;
}

.note {
    max-width: 68ch;
    margin: 0 0 var(--space-6);
    padding: var(--space-4) var(--space-5);
    border-radius: var(--radius-lg);

    font-size: var(--font-size-sm);
    line-height: 1.5;

    &--error {
        color: $error700;
        background: varToRgba('error500', 0.14);
    }

    &--warn {
        color: $warning700;
        background: varToRgba('warning500', 0.12);
    }
}

.queue {
    margin-bottom: var(--space-8);

    &_head {
        display: flex;
        gap: var(--space-3);
        align-items: baseline;

        margin: 0 0 var(--space-4);

        font-size: var(--font-size-md);
        font-weight: 680;
        color: $content2;
    }

    &_count {
        font-size: var(--font-size-sm);
        font-weight: 600;
        color: $content7;
    }

    &_empty {
        margin: 0;
        font-size: var(--font-size-sm);
        font-style: italic;
        color: $content7;
    }

    &_rows {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);

        margin: 0;
        padding: 0;

        list-style: none;
    }
}

.row {
    display: flex;
    gap: var(--space-4);
    align-items: center;
    justify-content: space-between;

    padding: var(--space-4) var(--space-5);
    border-radius: var(--radius-lg);

    background: $surface1;

    &_main {
        display: flex;
        flex-direction: column;
        gap: 2px;

        min-width: 0;

        color: $content3;
    }

    &_meta {
        font-size: var(--font-size-sm);
        color: $content7;

        &--warn { color: $warning700; }
    }

    &_note {
        font-size: var(--font-size-sm);
        font-style: italic;
        color: $content5;
    }

    &_actions {
        display: flex;
        flex: none;
        gap: var(--space-2);
    }

    &_status {
        flex: none;
        font-size: var(--font-size-sm);
        color: $content7;
    }
}
</style>
