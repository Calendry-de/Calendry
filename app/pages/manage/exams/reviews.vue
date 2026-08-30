<template>
    <ManageShell
        description="Exams lecturers have asked for on their own modules, waiting on a decision."
        title="Exam review"
    >
        <p class="intro">
            An approved exam becomes a <strong>locked event</strong> at the slot that was
            asked for — it occupies its room and its people, and no solve will move it.
            Approving is the moment the schedule changes, not a formality afterwards.
        </p>

        <p
            v-if="error"
            class="note note--error"
            role="alert"
        >{{ error }}</p>

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
                        <span class="row_meta">
                            {{ row.kind.name }} · {{ row.term.name }} · week {{ row.termWeek }},
                            {{ weekdayName(row.dayOfWeek) }},
                            {{ row.durationBlocks }} block{{ row.durationBlocks === 1 ? '' : 's' }}
                            from block {{ row.blockIndex + 1 }}
                        </span>
                        <span class="row_meta">
                            asked for by {{ personName(row.requestedBy) }}{{ row.room ? ` · prefers ${row.room.name}` : '' }}
                        </span>
                        <span
                            v-if="row.note"
                            class="row_note"
                        >“{{ row.note }}”</span>
                    </div>

                    <div
                        v-if="row.status === 'PENDING'"
                        class="row_actions"
                    >
                        <CommonButton
                            :disabled="busy === row.id"
                            type="primary"
                            @click="decide(row.id, 'approve')"
                        >Approve</CommonButton>
                        <CommonButton
                            :disabled="busy === row.id"
                            type="secondary"
                            @click="decide(row.id, 'reject')"
                        >Reject</CommonButton>
                    </div>
                    <span
                        v-else
                        class="row_status"
                    >
                        {{ row.status === 'APPROVED' ? 'Approved' : 'Not approved' }}
                        by {{ personName(row.decidedBy) }}
                    </span>
                </li>
            </ul>
        </section>
    </ManageShell>
</template>

<script setup lang="ts">
import { weekdayName } from '~/composables/schedule';
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
     * recognise, and this is not a registry entity — it has no list, no row
     * form and no `/api/exams` resource behind it. Same reasoning the
     * unavailability review page already carries.
     */
    middleware: [
        () => {
            const held = new Set(useSession().value?.permissions ?? []);

            if (!held.has('exam.review')) {
                return abortNavigation(createError({
                    statusCode: 403,
                    statusMessage: 'Reviewing exam requests needs exam.review.',
                }));
            }
        },
    ],
});
useHead({ title: 'Exam review' });

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
        label: 'Waiting on a decision',
        empty: 'Nothing is waiting.',
        rows: rows.value.filter((r) => r.status === 'PENDING'),
    },
    {
        status: 'DECIDED',
        label: 'Decided',
        empty: 'Nothing has been decided yet.',
        rows: rows.value.filter((r) => r.status !== 'PENDING'),
    },
]);

/*
 * An unresolvable person shows as a word rather than an empty gap: the pointer
 * is ON DELETE SET NULL, so a decision outlives the administrator who made it
 * and the row must still read as a decision.
 */
function personName(person: Named | null): string {
    return person ? `${person.givenName} ${person.familyName}` : 'someone since removed';
}

const busy = ref('');
const error = ref('');

async function decide(id: string, action: 'approve' | 'reject') {
    busy.value = id;
    error.value = '';

    try {
        await request(`/api/exam-requests/${id}/${action}`, { method: 'POST', body: {} });
        await refresh();
    } catch (cause) {
        // The server's own sentence: approving can fail because the grid changed
        // under a pending request, and "could not save" would hide that.
        error.value = (cause as { statusMessage?: string })?.statusMessage
            ?? 'Could not record that decision.';
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
