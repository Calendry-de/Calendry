<template>
    <CommonPage title="My exams">
        <p class="intro">
            Ask for an exam on a module you lead. What you submit here is
            <strong>reviewed by an administrator</strong> before it appears on any
            timetable — an exam takes a room and an hour the schedule has to find, so
            it is not placed on your say-so alone.
        </p>

        <p
            v-if="error"
            class="note note--error"
            role="alert"
        >{{ error }}</p>

        <!--
            The two blocking states, named separately. "You lead no modules" and
            "this institution has no exam kind" both leave the form unusable and
            call for completely different action — one is a staffing fact, the
            other is a five-second settings change an administrator has to make.
            Collapsing them into one empty form would be the "no data vs. not
            configured" ambiguity this codebase keeps finding.
        -->
        <p
            v-if="!modules.length"
            class="note note--warn"
        >
            You are not listed as a lecturer on any module this term, so there is
            nothing to request an exam for.
        </p>
        <p
            v-else-if="!examKinds.length"
            class="note note--warn"
        >
            This institution has no session kind marked as an exam yet, so an exam
            cannot be recorded under one. An administrator sets that on a session
            kind.
        </p>

        <section
            v-else
            class="entry"
        >
            <h2 class="entry_head">Request an exam</h2>

            <div class="entry_grid">
                <label class="entry_field">
                    <span class="entry_label">Module</span>
                    <select
                        v-model="offeringId"
                        class="entry_input"
                    >
                        <!-- `:selected` so the choice survives SSR; a select's
                             value is a property and SSR drops it. -->
                        <option
                            v-for="m in modules"
                            :key="m.id"
                            :selected="m.id === offeringId"
                            :value="m.id"
                        >{{ m.code ? `${m.code} — ${m.title}` : m.title }}</option>
                    </select>
                </label>

                <label class="entry_field">
                    <span class="entry_label">Kind</span>
                    <select
                        v-model="kindId"
                        class="entry_input"
                    >
                        <option
                            v-for="k in examKinds"
                            :key="k.id"
                            :selected="k.id === kindId"
                            :value="k.id"
                        >{{ k.name }}</option>
                    </select>
                </label>

                <label class="entry_field">
                    <span class="entry_label">Week</span>
                    <input
                        v-model.number="termWeek"
                        class="entry_input"
                        min="1"
                        type="number"
                    >
                </label>

                <label class="entry_field">
                    <span class="entry_label">Day</span>
                    <select
                        v-model.number="dayOfWeek"
                        class="entry_input"
                    >
                        <option
                            v-for="d in activeDays"
                            :key="d"
                            :selected="d === dayOfWeek"
                            :value="d"
                        >{{ weekdayName(d) }}</option>
                    </select>
                </label>

                <label class="entry_field">
                    <span class="entry_label">Starts at</span>
                    <select
                        v-model.number="blockIndex"
                        class="entry_input"
                    >
                        <option
                            v-for="b in blockOptions"
                            :key="b.value"
                            :selected="b.value === blockIndex"
                            :value="b.value"
                        >{{ b.label }}</option>
                    </select>
                </label>

                <label class="entry_field">
                    <span class="entry_label">Length in blocks</span>
                    <input
                        v-model.number="durationBlocks"
                        class="entry_input"
                        min="1"
                        type="number"
                    >
                </label>

                <label class="entry_field entry_field--wide">
                    <span class="entry_label">Note for the reviewer</span>
                    <textarea
                        v-model="note"
                        class="entry_input"
                        rows="2"
                    />
                </label>
            </div>

            <CommonButton
                :disabled="busy || !offeringId || !kindId"
                type="primary"
                @click="submit"
            >{{ busy ? 'Sending…' : 'Request exam' }}</CommonButton>
        </section>

        <section class="list">
            <h2 class="list_head">Your requests</h2>

            <p
                v-if="!rows.length"
                class="list_empty"
            >You have not asked for an exam yet.</p>

            <ul
                v-else
                class="list_rows"
            >
                <li
                    v-for="row in rows"
                    :key="row.id"
                    class="row"
                >
                    <div class="row_main">
                        <strong>{{ row.offering.title }}</strong>
                        <span class="row_meta">
                            {{ row.kind.name }} · week {{ row.termWeek }},
                            {{ weekdayName(row.dayOfWeek) }} {{ startLabel(row.blockIndex) }}
                        </span>
                        <span
                            v-if="row.decisionNote"
                            class="row_meta"
                        >“{{ row.decisionNote }}”</span>
                    </div>
                    <!--
                        The status is the answer the page exists to give, so it
                        is a word rather than a colour alone.
                    -->
                    <span
                        class="row_status"
                        :class="`row_status--${row.status.toLowerCase()}`"
                    >{{ STATUS_LABEL[row.status] }}</span>
                </li>
            </ul>
        </section>
    </CommonPage>
</template>

<script setup lang="ts">
import { type TimeGrid, blockTime, weekdayName } from '~/composables/schedule';

/**
 * A lecturer's own exam requests, and the form to add one.
 *
 * GATED ON `exam.request_own` by the nav entry, but the page does not assume
 * it: every endpoint it calls carries the same key, and the two blocking
 * states above are rendered from what came back rather than from a permission
 * check — a page that decides its own emptiness from a gate tells a different
 * story than the server does.
 */
definePageMeta({ middleware: 'my' });
useHead({ title: 'My exams' });

interface RequestRow {
    id: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    termWeek: number;
    dayOfWeek: number;
    blockIndex: number;
    durationBlocks: number;
    decisionNote: string | null;
    offering: { id: string; title: string; code: string | null };
    kind: { id: string; name: string };
}

const STATUS_LABEL: Record<RequestRow['status'], string> = {
    PENDING: 'Awaiting a decision',
    APPROVED: 'Approved',
    REJECTED: 'Not approved',
};

// `useRequestFetch`, not `$fetch`: a bare fetch drops the cookie server-side
// and 401s into an empty page indistinguishable from having asked for nothing.
const request = useRequestFetch();

const { data, refresh } = await useAsyncData('my:exams', async () => {
    const [mine, offerings, kinds, grids] = await Promise.all([
        request<{ rows: RequestRow[] }>('/api/me/exam-requests'),
        request<{ rows: { id: string; title: string; code: string | null }[] }>(
            '/api/offerings?limit=200',
        ),
        request<{ rows: { id: string; name: string; type: string }[] }>(
            '/api/session-kinds?limit=200',
        ),
        // Typed as the schedule's own `TimeGrid`, not a local shape: `blockTime()`
        // takes that interface, and a structurally-similar duplicate here would
        // drift from it silently the next time the grid gains a field.
        request<{ rows: TimeGrid[] }>('/api/time-grids?limit=50'),
    ]);

    return { mine: mine.rows, offerings: offerings.rows, kinds: kinds.rows, grids: grids.rows };
});

const rows = computed(() => data.value?.mine ?? []);

/*
 * Every Offering the API returns, which is already narrowed by what this person
 * may read. The SERVER decides whether they lead it — `assertLeadsOffering`
 * answers 404 either way — so this list is a convenience, never the boundary.
 */
const modules = computed(() => data.value?.offerings ?? []);

/** Only kinds classified as exams; the write boundary refuses any other. */
const examKinds = computed(() => (data.value?.kinds ?? []).filter((k) => k.type === 'EXAM'));

const grid = computed(() => data.value?.grids?.find((g) => g.isDefault) ?? data.value?.grids?.[0]);
const activeDays = computed(() => grid.value?.activeDays ?? [1, 2, 3, 4, 5]);

function startLabel(index: number): string {
    return grid.value ? blockTime(grid.value, index).start : `block ${index + 1}`;
}

const blockOptions = computed(() => Array.from(
    { length: grid.value?.blocksPerDay ?? 0 },
    (_, index) => ({ value: index, label: startLabel(index) }),
));

const offeringId = ref('');
const kindId = ref('');
const termWeek = ref(1);
const dayOfWeek = ref(activeDays.value[0] ?? 1);
const blockIndex = ref(0);
const durationBlocks = ref(1);
const note = ref('');
const busy = ref(false);
const error = ref('');

/*
 * Seeded from a COMPUTED read at setup, not from a watcher. Vue does not flush
 * watchers during SSR, so a watcher-seeded default is undefined on the server's
 * render and the selects come back empty.
 */
offeringId.value = modules.value[0]?.id ?? '';
kindId.value = examKinds.value[0]?.id ?? '';

async function submit() {
    busy.value = true;
    error.value = '';

    try {
        await request('/api/me/exam-requests', {
            method: 'POST',
            body: {
                offeringId: offeringId.value,
                kindId: kindId.value,
                termWeek: termWeek.value,
                dayOfWeek: dayOfWeek.value,
                blockIndex: blockIndex.value,
                durationBlocks: durationBlocks.value,
                note: note.value || null,
            },
        });

        note.value = '';
        await refresh();
    } catch (cause) {
        // The server's own sentence, which names the module or the kind. A
        // generic "could not save" would hide the one thing that is fixable.
        error.value = (cause as { statusMessage?: string })?.statusMessage
            ?? 'Could not send that request.';
    } finally {
        busy.value = false;
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
    display: flex;
    gap: var(--space-3);
    align-items: center;

    max-width: 68ch;
    margin: 0 0 var(--space-6);
    padding: var(--space-4) var(--space-5);
    border-radius: var(--radius-lg);

    font-size: var(--font-size-sm);
    line-height: 1.5;
    color: $content5;

    background: $surface1;

    &--warn {
        color: $warning700;
        background: varToRgba('warning500', 0.12);
    }

    &--error {
        color: $error700;
        background: varToRgba('error500', 0.14);
    }
}

.entry {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);

    margin-bottom: var(--space-8);
    padding: var(--space-6);
    border-radius: var(--radius-xl);

    background: $surface1;

    &_head {
        margin: 0;
        font-size: var(--font-size-md);
        font-weight: 680;
        color: $content2;
    }

    &_grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: var(--space-4);
    }

    &_field {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);

        &--wide { grid-column: 1 / -1; }
    }

    &_label {
        font-size: var(--font-size-sm);
        font-weight: 650;
        color: $content4;
    }

    &_input {
        width: 100%;
        padding: var(--space-3) var(--space-4);
        border: 1px solid $surface4;
        border-radius: var(--radius-lg);

        font-family: inherit;
        font-size: var(--font-size-md);
        color: $content3;

        background: $surface0;
    }
}

.list {
    &_head {
        margin: 0 0 var(--space-4);
        font-size: var(--font-size-md);
        font-weight: 680;
        color: $content2;
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

    &_status {
        flex: none;

        padding: var(--space-1) var(--space-3);
        border-radius: var(--radius-sm);

        font-size: var(--font-size-xs);
        font-weight: 650;

        &--pending {
            color: $warning700;
            background: varToRgba('warning500', 0.14);
        }

        &--approved {
            color: $success700;
            background: varToRgba('success500', 0.14);
        }

        &--rejected {
            color: $error700;
            background: varToRgba('error500', 0.14);
        }
    }
}
</style>
