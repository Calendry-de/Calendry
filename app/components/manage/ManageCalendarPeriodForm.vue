<template>
    <ManageEntityForm
        v-model:draft="draft"
        :can-delete="canDelete"
        :can-update="canUpdate"
        :form="form"
        :mode="mode"
        @request-delete="$emit('request-delete')"
        @reset="$emit('reset')"
        @save="$emit('save')"
    >
        <template #fields>
            <div class="wk">
                <span class="wk_label">Weeks this reclassifies</span>

                <p
                    v-if="!term"
                    class="wk_hint"
                >Choose a term to see which weeks this period affects.</p>

                <p
                    v-else-if="!validRange"
                    class="wk_hint"
                >Enter a start and end date to see which weeks this period affects.</p>

                <template v-else>
                    <ol class="wk_list">
                        <li
                            v-for="week in weeks"
                            :key="week.index"
                            class="wk_row"
                            :class="{ 'wk_row--hit': week.changed }"
                        >
                            <span class="wk_no">Week {{ week.index + 1 }}</span>
                            <span class="wk_date">{{ week.startDate }}</span>
                            <span
                                class="wk_kind"
                                :class="`wk_kind--${week.kind.toLowerCase()}`"
                            >{{ week.kind }}</span>
                            <span
                                v-if="week.changed"
                                class="wk_note"
                            >was {{ week.was }}</span>
                        </li>
                    </ol>

                    <p class="wk_hint">
                        <template v-if="changedCount === 0">
                            This period reclassifies no week.
                            <template v-if="kind === 'EXAM'">
                                An exam period claims any week it touches, so this one falls outside the term.
                            </template>
                            <template v-else>
                                A {{ kind.toLowerCase() }} claims a week only if it covers the whole of it —
                                Monday to Sunday.
                            </template>
                        </template>
                        <template v-else>
                            {{ changedCount }} week{{ changedCount === 1 ? '' : 's' }} reclassified.
                            <template v-if="kind === 'EXAM'">
                                An exam period claims every week it <em>touches</em>, so a period ending on a
                                Monday still claims that whole week.
                            </template>
                            <template v-else>
                                A {{ kind.toLowerCase() }} claims a week only when it covers the whole of it.
                            </template>
                        </template>
                    </p>
                </template>
            </div>
        </template>
    </ManageEntityForm>
</template>

<script setup lang="ts">
import type { useEntityForm } from '~/composables/entityForm';
import type { EntityRow } from '~/utils/manageRegistry';
import ManageEntityForm from '~/components/manage/ManageEntityForm.vue';
import {
    WEEK_KIND_NAME, classifyWeeks,
} from '~~/shared/academicCalendar';
import type { CalendarPeriodLike, PeriodKind } from '~~/shared/academicCalendar';

/**
 * Calendar period's detail: the generic form plus the one thing it cannot say.
 *
 * WHY A PREVIEW EARNS ITS PLACE HERE
 * ----------------------------------
 * The mapping from two dates to a set of week kinds is genuinely unpredictable.
 * An exam period of 2027-09-27 to 2027-10-18 marks FOUR weeks EXAM, not three,
 * because the precedence rule is "touches" — the week beginning 2027-10-18
 * counts even though only its Monday falls inside. BREAK and HOLIDAY use
 * "covers the entire week" instead, so the same dates produce a different
 * answer depending on the kind chosen. Nobody derives that from two date
 * inputs, and getting it wrong silently moves a term's teaching weeks.
 *
 * ONE DEFINITION, NOT TWO
 * -----------------------
 * `classifyWeeks` is imported from `shared/`, and is the SAME function
 * `buildAcademicCalendar` calls to build what the solver is told. A preview
 * computed locally would eventually disagree with the wire, and would then
 * state the opposite of the truth while looking authoritative — the failure the
 * `<select>`/`:selected` bug produced on the schedule page. Same discipline as
 * `shared/timeGrid.ts`.
 */
const props = defineProps<{
    form: ReturnType<typeof useEntityForm>;
    mode: 'create' | 'edit';
    canUpdate: boolean;
    canDelete: boolean;
}>();

defineEmits<{ save: []; reset: []; 'request-delete': [] }>();

const draft = defineModel<Record<string, unknown>>('draft', { required: true });

/** Terms, fetched by the form composable because `termId` declares the reference. */
const terms = computed<EntityRow[]>(() => props.form.references.value.terms ?? []);

const term = computed(() => terms.value.find((t) => String(t.id) === String(draft.value.termId ?? '')));

const kind = computed(() => (draft.value.kind as PeriodKind | undefined) ?? 'EXAM');

/** A date input yields '' before it is filled; `new Date('')` is Invalid Date. */
function asDate(value: unknown): Date | null {
    if (!value) {
        return null;
    }

    const date = new Date(String(value).slice(0, 10));

    return Number.isNaN(date.getTime()) ? null : date;
}

const startDate = computed(() => asDate(draft.value.startDate));
const endDate = computed(() => asDate(draft.value.endDate));

const validRange = computed(() => startDate.value !== null && endDate.value !== null
    && endDate.value >= startDate.value);

/**
 * Both classifications: the term as it is WITHOUT this period, and with it.
 *
 * The comparison is what makes the preview readable — "week 3 is EXAM" is far
 * less useful than "week 3 becomes EXAM, and was TEACHING". Other existing
 * periods are deliberately NOT loaded: this answers "what does THIS period do",
 * and folding in the rest would make an unchanged row look like this period's
 * doing.
 */
const weeks = computed(() => {
    const t = term.value;

    if (!t || !validRange.value) {
        return [];
    }

    const termStart = new Date(String(t.startDate).slice(0, 10));
    const termEnd = new Date(String(t.endDate).slice(0, 10));

    const period: CalendarPeriodLike = {
        kind: kind.value,
        startDate: startDate.value!,
        endDate: endDate.value!,
    };

    const before = classifyWeeks(termStart, termEnd, []);
    const after = classifyWeeks(termStart, termEnd, [period]);

    return after.map((week, index) => {
        const was = WEEK_KIND_NAME[before[index]!.kind] ?? 'TEACHING';
        const now = WEEK_KIND_NAME[week.kind] ?? 'TEACHING';

        return { index: week.index, startDate: week.startDate, kind: now, was, changed: now !== was };
    });
});

const changedCount = computed(() => weeks.value.filter((w) => w.changed).length);
</script>

<style scoped lang="scss">
.wk {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);

    &_label {
        font-size: var(--font-size-sm);
        font-weight: 650;
        color: $content4;
    }

    &_list {
        overflow-y: auto;

        max-height: 320px;
        margin: 0;
        padding: var(--space-2);
        border: 1px solid $surface4;
        border-radius: var(--radius-lg);

        list-style: none;

        background: $surface0;
    }

    &_row {
        display: grid;
        grid-template-columns: 5.5rem 6.5rem auto 1fr;
        gap: var(--space-4);
        align-items: baseline;

        padding: var(--space-2) var(--space-3);
        border-radius: var(--radius-sm);

        font-size: var(--font-size-sm);
        color: $content7;

        &--hit {
            font-weight: 600;
            color: $content3;
            background: $whiteAlpha4;
        }
    }

    &_no { font-variant-numeric: tabular-nums; }

    &_date {
        font-variant-numeric: tabular-nums;
        color: $content7;
    }

    &_kind {
        padding: 0 var(--space-3);
        border-radius: var(--radius-sm);

        font-size: var(--font-size-xs);
        font-weight: 700;
        letter-spacing: 0.04em;

        &--exam { color: $error700; }
        &--break, &--holiday { color: $warning700; }
        &--teaching { color: $content7; }
    }

    &_note {
        font-size: var(--font-size-xs);
        font-weight: 400;
        color: $content7;
    }

    &_hint {
        margin: 0;
        font-size: var(--font-size-sm);
        line-height: 1.5;
        color: $content7;

        em {
            font-weight: 650;
            font-style: normal;
        }
    }
}
</style>
