<template>
    <CommonPage :title="t('my.exams.pageTitle')">
        <!--
            `<i18n-t>`: the emphasised clause is part of the sentence's grammar,
            and German would not leave it where English does.
        -->
        <i18n-t
            class="intro"
            keypath="my.exams.intro"
            scope="global"
            tag="p"
        >
            <template #reviewed>
                <strong>{{ t('my.exams.introReviewed') }}</strong>
            </template>
        </i18n-t>

        <p
            v-if="error"
            class="note note--error"
            role="alert"
        >{{ error }}</p>

        <!--
            WARN, DON'T BLOCK: the request above already went through. This
            says the module's own teaching plan is not fully placed yet: a
            fact for the lecturer to know, never a reason the request was
            refused.
        -->
        <p
            v-if="teachingWarning"
            class="note note--warn"
            role="status"
        >{{ teachingWarning }}</p>

        <!--
            The two blocking states, named separately. "You lead no modules" and
            "this institution has no exam kind" both leave the form unusable and
            call for completely different action: one is a staffing fact, the
            other is a five-second settings change an administrator has to make.
            Collapsing them into one empty form would be the "no data vs. not
            configured" ambiguity this codebase keeps finding.
        -->
        <p
            v-if="!modules.length"
            class="note note--warn"
        >
            {{ t('my.exams.noModules') }}
        </p>
        <p
            v-else-if="!examKinds.length"
            class="note note--warn"
        >
            {{ t('my.exams.noExamKinds') }}
        </p>

        <section
            v-else
            class="entry"
        >
            <h2 class="entry_head">{{ t('my.exams.entryHead') }}</h2>

            <div class="entry_grid">
                <label class="entry_field">
                    <span class="entry_label">{{ t('my.exams.moduleLabel') }}</span>
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
                        >{{ moduleLabel(m) }}</option>
                    </select>
                </label>

                <label class="entry_field">
                    <span class="entry_label">{{ t('my.exams.kindLabel') }}</span>
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
                    <span class="entry_label">{{ t('my.exams.weekLabel') }}</span>
                    <select
                        v-model.number="termWeek"
                        class="entry_input"
                    >
                        <option
                            v-for="w in weeks"
                            :key="w.week"
                            :selected="w.week === termWeek"
                            :value="w.week"
                        >{{ w.label }}</option>
                    </select>
                </label>

                <label class="entry_field">
                    <span class="entry_label">{{ t('my.exams.dayLabel') }}</span>
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
                    <span class="entry_label">{{ t('my.exams.startLabel') }}</span>
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
                    <span class="entry_label">{{ t('my.exams.durationLabel') }}</span>
                    <input
                        v-model.number="durationBlocks"
                        class="entry_input"
                        min="1"
                        type="number"
                    >
                </label>

                <!--
                    ADVISORY, NEVER A GATE. A Nachklausur legitimately sits in an
                    ordinary teaching week (the timetable this demo's data came
                    from is full of them), so this says what the institution
                    declared and leaves the choice alone.
                -->
                <p
                    v-if="examWeeks.length && !chosenIsExamWeek"
                    class="entry_advice entry_field--wide"
                >
                    {{ examPeriodAdvice }}
                </p>
                <p
                    v-else-if="!examWeeks.length"
                    class="entry_advice entry_field--wide"
                >
                    {{ t('my.exams.noExamPeriod') }}
                </p>

                <label class="entry_field entry_field--wide">
                    <span class="entry_label">{{ t('my.exams.noteLabel') }}</span>
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
            >{{ busy ? t('my.exams.submitBusy') : t('my.exams.submit') }}</CommonButton>
        </section>

        <section class="list">
            <h2 class="list_head">{{ t('my.exams.listHead') }}</h2>

            <p
                v-if="!rows.length"
                class="list_empty"
            >{{ t('my.exams.listEmpty') }}</p>

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
                        <!--
                            ONE message per shape, not a sentence with an
                            " (exam week)" clause spliced into the middle of it.
                            That splice is why the mustaches had to be joined by
                            an HTML comment; a translator could not have moved it.
                        -->
                        <span class="row_meta">{{ requestMeta(row) }}</span>
                        <!--
                            The teaching-plan fact itself, not just a message
                            shown once when this request was submitted: it can
                            change (more Sessions get placed) after the fact,
                            and a pending request's own state is worth seeing
                            without re-submitting anything.
                        -->
                        <span
                            v-if="!row.teachingComplete.complete"
                            class="row_meta row_meta--warn"
                        >{{ t('my.exams.teachingPlanRow', {
                            placed: row.teachingComplete.placedCount,
                            required: row.teachingComplete.requiredCount,
                        }) }}</span>

                        <span
                            v-if="row.decisionNote"
                            class="row_meta"
                        >{{ t('my.exams.decisionNote', { note: row.decisionNote }) }}</span>
                    </div>
                    <!--
                        The status is the answer the page exists to give, so it
                        is a word rather than a colour alone.
                    -->
                    <span
                        class="row_status"
                        :class="`row_status--${row.status.toLowerCase()}`"
                    >{{ statusLabel[row.status] }}</span>
                </li>
            </ul>
        </section>
    </CommonPage>
</template>

<script setup lang="ts">
import { type TimeGrid, blockTime, weekdayName } from '~/composables/schedule';
import { WEEK_KIND_NAME, classifyWeeks } from '#shared/academicCalendar';
import { useT } from '~/composables/i18n';

/**
 * A lecturer's own exam requests, and the form to add one.
 *
 * GATED ON `exam.request_own` by the nav entry, but the page does not assume
 * it: every endpoint it calls carries the same key, and the two blocking
 * states above are rendered from what came back rather than from a permission
 * check: a page that decides its own emptiness from a gate tells a different
 * story than the server does.
 */
definePageMeta({ middleware: 'my' });

const { t } = useT();

useHead(() => ({ title: t('my.exams.pageTitle') }));

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
    /** Resolved per Term by the server, so both exam pages agree. */
    weekKind: string;
    /** Issue #101: the module's own teaching plan, not this request's placement. */
    teachingComplete: { complete: boolean; placedCount: number; requiredCount: number };
}

/*
 * A COMPUTED map, not a module constant: a constant is evaluated once, before
 * any language is known, so it would freeze the first render's language for the
 * life of the page.
 */
const statusLabel = computed<Record<RequestRow['status'], string>>(() => ({
    PENDING: t('my.exams.statusPending'),
    APPROVED: t('my.exams.statusApproved'),
    REJECTED: t('my.exams.statusRejected'),
}));

// `useRequestFetch`, not `$fetch`: a bare fetch drops the cookie server-side
// and 401s into an empty page indistinguishable from having asked for nothing.
const request = useRequestFetch();

interface ExamContext {
    offerings: { id: string; title: string; code: string | null; termId: string }[];
    kinds: { id: string; name: string; type: string }[];
    // Typed as the schedule's own `TimeGrid`, not a local shape: `blockTime()`
    // takes that interface, and a structurally-similar duplicate here would
    // drift from it silently the next time the grid gains a field.
    grids: TimeGrid[];
    terms: { id: string; name: string; startDate: string; endDate: string }[];
    periods: { termId: string; kind: string; startDate: string; endDate: string }[];
}

const { data, refresh } = await useAsyncData('my:exams', async () => {
    /*
     * ONE key, TWO endpoints, not five. `/api/me/exam-requests/context`
     * replaced four generic CRUD reads (`/api/offerings`, `/api/session-kinds`,
     * `/api/time-grids`, `/api/terms`, `/api/calendar-periods`), each gated on
     * its own institution-wide `<resource>.read`. A lecturer holding only
     * `exam.request_own` (this page's actual gate) held none of those, so the
     * `Promise.all` 403'd on the first of them and the page rendered BLANK
     * (issue #108). See that route's own comment for the full story.
     */
    const [mine, context] = await Promise.all([
        request<{ rows: RequestRow[] }>('/api/me/exam-requests'),
        request<ExamContext>('/api/me/exam-requests/context'),
    ]);

    return {
        mine: mine.rows,
        offerings: context.offerings,
        kinds: context.kinds,
        grids: context.grids,
        terms: context.terms,
        periods: context.periods,
    };
});

const rows = computed(() => data.value?.mine ?? []);

/*
 * Every Offering the API returns, which is already narrowed by what this person
 * may read. The SERVER decides whether they lead it: `assertLeadsOffering`
 * answers 404 either way, so this list is a convenience, never the boundary.
 */
const modules = computed(() => data.value?.offerings ?? []);

/** Only kinds classified as exams; the write boundary refuses any other. */
const examKinds = computed(() => (data.value?.kinds ?? []).filter((k) => k.type === 'EXAM'));

const grid = computed(() => data.value?.grids?.find((g) => g.isDefault) ?? data.value?.grids?.[0]);
const activeDays = computed(() => grid.value?.activeDays ?? [1, 2, 3, 4, 5]);

function startLabel(index: number): string {
    return grid.value
        ? blockTime(grid.value, index).start
        : t('my.exams.startFallback', { block: index + 1 });
}

/** "CODE: Title", or the title alone. */
function moduleLabel(offering: { title: string; code: string | null }): string {
    return offering.code
        ? t('my.exams.moduleWithCode', { code: offering.code, title: offering.title })
        : offering.title;
}

/**
 * One row's line, as ONE message chosen by whether the week is an exam week.
 */
function requestMeta(row: RequestRow): string {
    const values = {
        kind: row.kind.name,
        week: row.termWeek,
        day: weekdayName(row.dayOfWeek),
        start: startLabel(row.blockIndex),
    };

    return row.weekKind === 'EXAM'
        ? t('my.exams.requestMetaExamWeek', values)
        : t('my.exams.requestMeta', values);
}

const blockOptions = computed(() => Array.from(
    { length: grid.value?.blocksPerDay ?? 0 },
    (_, index) => ({ value: index, label: startLabel(index) }),
));

/**
 * The chosen module's Term, and its weeks classified.
 *
 * `classifyWeeks` is the SAME function the server's `classifyTermWeeks` calls
 * and the same one the solver calendar is built from, imported from `#shared`
 * rather than reimplemented, because "which week is an exam week" having two
 * definitions is exactly the failure TimeGrid already demonstrated.
 */
const term = computed(() => {
    const module = modules.value.find((m) => m.id === offeringId.value);

    return data.value?.terms?.find((t) => t.id === module?.termId);
});

const weeks = computed(() => {
    const t = term.value;

    if (!t) {
        return [];
    }

    const periods = (data.value?.periods ?? [])
        .filter((p) => p.termId === t.id)
        .map((p) => ({ kind: p.kind as 'EXAM' | 'BREAK' | 'HOLIDAY', startDate: new Date(p.startDate), endDate: new Date(p.endDate) }));

    return classifyWeeks(new Date(t.startDate), new Date(t.endDate), periods).map((w) => {
        const kind = WEEK_KIND_NAME[w.kind] ?? 'UNSPECIFIED';

        return {
            week: w.index + 1,
            kind,
            // The kind is IN the label, not a colour beside it: this select is
            // the one place the choice is made, and an exam week that reads the
            // same as every other week is a choice made blind.
            //
            // ONE MESSAGE PER KIND, never `kind.toLowerCase()` interpolated
            // into a template: lowercasing an enum name only produces English,
            // and the word has to be declined where it stands.
            label: weekLabel(kind, w.index + 1),
        };
    });
});

/** A week's own name, per classified kind. */
function weekLabel(kind: string, week: number): string {
    if (kind === 'EXAM') {
        return t('my.exams.weekExam', { week });
    }

    if (kind === 'BREAK') {
        return t('my.exams.weekBreak', { week });
    }

    if (kind === 'HOLIDAY') {
        return t('my.exams.weekHoliday', { week });
    }

    return t('my.exams.weekPlain', { week });
}

const examWeeks = computed(() => weeks.value.filter((w) => w.kind === 'EXAM'));
const chosenIsExamWeek = computed(() => examWeeks.value.some((w) => w.week === termWeek.value));

/**
 * The advisory, WHOLE, in one message per shape.
 *
 * The sentence used to be built in two halves, a computed naming the weeks and
 * a trailing clause in the template. Neither half is a sentence, so neither was
 * translatable on its own.
 */
const examPeriodAdvice = computed(() => {
    const list = examWeeks.value.map((w) => w.week);

    if (!list.length) {
        return '';
    }

    return list.length === 1
        ? t('my.exams.examPeriodOne', { week: list[0] })
        : t('my.exams.examPeriodRange', { from: list[0], to: list[list.length - 1] });
});

const offeringId = ref('');
const kindId = ref('');
const termWeek = ref(1);
const dayOfWeek = ref(activeDays.value[0] ?? 1);
const blockIndex = ref(0);
const durationBlocks = ref(1);
const note = ref('');
const busy = ref(false);
const error = ref('');
const teachingWarning = ref('');

/*
 * Seeded from a COMPUTED read at setup, not from a watcher. Vue does not flush
 * watchers during SSR, so a watcher-seeded default is undefined on the server's
 * render and the selects come back empty.
 */
offeringId.value = modules.value[0]?.id ?? '';
kindId.value = examKinds.value[0]?.id ?? '';
/*
 * THE FIRST EXAM WEEK, not week 1. An exam is a locked Event the solver never
 * places, so `MinimizeExamWeek` cannot pull it anywhere: the default IS the
 * placement for anyone who does not change it, and defaulting to the first week
 * of term was actively wrong.
 */
termWeek.value = examWeeks.value[0]?.week ?? 1;

async function submit() {
    busy.value = true;
    error.value = '';
    teachingWarning.value = '';

    try {
        const { teachingComplete } = await request<{
            teachingComplete: { complete: boolean; placedCount: number; requiredCount: number };
        }>('/api/me/exam-requests', {
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

        if (!teachingComplete.complete) {
            teachingWarning.value = t('my.exams.teachingWarning', {
                placed: teachingComplete.placedCount,
                required: teachingComplete.requiredCount,
            });
        }

        note.value = '';
        await refresh();
    } catch (cause) {
        // The server's own sentence, which names the module or the kind. A
        // generic "could not save" would hide the one thing that is fixable.
        error.value = serverErrorMessage(cause)
            ?? t('my.exams.submitError');
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

    /* Advisory, in the warning palette rather than the error one: nothing is
       wrong, and the choice it describes is still allowed. */
    &_advice {
        margin: 0;
        padding: var(--space-3) var(--space-4);
        border-radius: var(--radius-lg);

        font-size: var(--font-size-sm);
        line-height: 1.5;
        color: $warning700;

        background: varToRgba('warning500', 0.12);
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

        &--warn { color: $warning700; }
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
