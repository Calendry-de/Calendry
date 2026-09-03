<template>
    <div class="holiday">
        <div class="holiday_dates">
            <label class="holiday_field">
                <span class="holiday_label">{{ t('availability.holidayForm.firstDay') }}</span>
                <input
                    v-model="startDate"
                    class="holiday_input"
                    type="date"
                >
            </label>

            <label class="holiday_field">
                <span class="holiday_label">{{ t('availability.holidayForm.lastDay') }}</span>
                <input
                    v-model="endDate"
                    class="holiday_input"
                    type="date"
                >
            </label>
        </div>

        <label class="holiday_field">
            <span class="holiday_label">{{ t('availability.holidayForm.reason') }}</span>
            <input
                v-model="reason"
                class="holiday_input"
                maxlength="500"
                :placeholder="t('availability.holidayForm.reasonPlaceholder')"
                type="text"
            >
        </label>

        <!--
            THE PREVIEW IS THE POINT, not decoration. A date range does not map
            to term weeks in any way somebody can predict from two dates. That is
            exactly the reasoning that earned the calendar-period editor its own
            week-reclassification preview. Each end week names the days it
            actually covers (issue #118): until then a touched week was blocked
            in FULL and this preview was where that over-block was disclosed.
        -->
        <div
            v-if="preview"
            class="holiday_preview"
        >
            <!--
                ONE message, not a term name glued to a hand-built plural. The
                sentence carried `week{{ n === 1 ? '' : 's' }}`, and a word split
                across mustaches has no key at all: German pluralises by stem,
                not by an `-s` suffix. `<i18n-t>` is what lets the `<strong>`
                stay markup while the whole sentence stays one translatable
                string, the same technique the login page's landing prompt uses.
            -->
            <i18n-t
                class="holiday_preview-head"
                keypath="availability.holidayForm.previewHead"
                :plural="preview.weeks.length"
                scope="global"
                tag="p"
            >
                <template #term>
                    <strong>{{ preview.term.name }}</strong>
                </template>
            </i18n-t>

            <ul class="holiday_weeks">
                <li
                    v-for="week in preview.touched"
                    :key="week.index"
                    class="holiday_week"
                    :class="{ 'holiday_week--partial': !week.whole }"
                >
                    {{ t('availability.holidayForm.weekRow', {
                        week: week.index + 1,
                        start: week.start,
                        end: week.end,
                    }) }}
                    <!--
                        `days` is EMPTY for a whole week (the wire's own
                        convention), so only a partial week names its days.
                    -->
                    <span v-if="!week.whole && coveredDays(week).length">{{ t('availability.holidayForm.weekDays', {
                        days: coveredDays(week).map((day) => weekdayName(day, locale)).join(', '),
                    }) }}</span>
                </li>
            </ul>
        </div>

        <p
            v-else-if="problem"
            class="holiday_note holiday_note--warn"
        >{{ problem }}</p>

        <p
            v-if="error"
            class="holiday_note holiday_note--error"
            role="alert"
        >{{ error }}</p>

        <div class="holiday_actions">
            <CommonButton
                :disabled="busy || !preview"
                type="primary"
                @click="submit"
            >{{ busy ? t('availability.holidayForm.submitBusy') : submitLabel }}</CommonButton>
        </div>
    </div>
</template>

<script setup lang="ts">
import type { HolidayResolution, TermWindow, TouchedWeek } from '#shared/availability';
import { resolveHolidayWeeks } from '#shared/availability';
import { overlaps } from '#shared/academicCalendar';
import { useT } from '~/composables/i18n';
import { useViewerLocale } from '~/composables/locale';
import { weekdayName } from '~/composables/schedule';

/**
 * Pick real dates; see the weeks they block.
 *
 * THE PREVIEW USES THE SAME RESOLVER THE SERVER DOES: `resolveHolidayWeeks`
 * from `shared/`, not a local date walk. A client-side copy would drift from
 * what is actually stored and would do it invisibly, which is the failure this
 * codebase has recorded for `blockTime`, for `weekIndexOf` and for
 * `classifyWeeks` in turn. The server still resolves independently on submit and
 * remains the authority; this only stops somebody submitting blind.
 */
const props = defineProps<{
    terms: TermWindow[];
    /**
     * The grid's teaching days, for DISPLAY only: a Wed–Sun absence in a
     * Mon–Fri tenant reads "Wednesday, Thursday, Friday", not a list ending in
     * a weekend nobody teaches. The window sent still names every covered
     * day, which is harmless (a day with no slots blocks nothing) and keeps
     * the stored fact independent of which grid happens to be default.
     */
    activeDays?: number[];
    busy?: boolean;
    error?: string;
    submitLabel?: string;
}>();

const emit = defineEmits<{ submit: [payload: { startDate: string; endDate: string; reason: string | null }] }>();

const { t } = useT();
// The viewer's formatting locale, the same source every other weekday label
// in the app reads (`ScheduleGrid`, `ScheduleInspector`).
const locale = useViewerLocale();

const startDate = ref('');
const endDate = ref('');
const reason = ref('');

const submitLabel = computed(() => props.submitLabel ?? t('availability.holidayForm.submit'));

interface Preview extends HolidayResolution {
    term: TermWindow;
}

/**
 * "A and B", or "A and B and C", with the conjunction in the CATALOGUE.
 *
 * `join(' and ')` left an English word in every language, and a bare `' and '`
 * key would be a fragment with no grammar around it. Folding pairwise through a
 * two-placeholder message keeps the conjunction translatable at any list length
 * without the separator ever existing on its own.
 */
function joinWithAnd(names: string[]): string {
    return names.reduce((list, next) => t('availability.holidayForm.termListJoin', { list, next }));
}

/**
 * Mirrors `resolveHolidayRange` on the server, including WHY it refuses.
 *
 * Both refusals are states a person can reach by typing plausible dates, and
 * both would otherwise be a 422 after pressing the button. Explaining them here
 * is cheaper for the user and does not weaken the server, which still decides.
 */
const problem = computed(() => {
    if (!startDate.value || !endDate.value) {
        return '';
    }

    const from = new Date(startDate.value);
    const to = new Date(endDate.value);

    if (to.getTime() < from.getTime()) {
        return t('availability.holidayForm.problemReversed');
    }

    const matching = props.terms.filter((term) => overlaps(
        new Date(term.startDate),
        new Date(term.endDate),
        from,
        to,
    ));

    if (matching.length === 0) {
        return props.terms.length
            ? t('availability.holidayForm.problemOutsideTerms', {
                terms: props.terms
                    .map((term) => t('availability.holidayForm.termRange', {
                        name: term.name,
                        from: term.startDate,
                        to: term.endDate,
                    }))
                    .join(', '),
            })
            : t('availability.holidayForm.problemNoTerms');
    }

    if (matching.length > 1) {
        return t('availability.holidayForm.problemSpansTerms', { terms: joinWithAnd(matching.map((term) => term.name)) });
    }

    return '';
});

const preview = computed<Preview | null>(() => {
    if (problem.value || !startDate.value || !endDate.value) {
        return null;
    }

    const from = new Date(startDate.value);
    const to = new Date(endDate.value);
    const term = props.terms.find((candidate) => overlaps(
        new Date(candidate.startDate),
        new Date(candidate.endDate),
        from,
        to,
    ));

    if (!term) {
        return null;
    }

    const resolution = resolveHolidayWeeks(new Date(term.startDate), new Date(term.endDate), from, to);

    return resolution.weeks.length ? { ...resolution, term } : null;
});

/** The covered days of a partial week that the tenant actually teaches on. */
function coveredDays(week: TouchedWeek): number[] {
    return props.activeDays?.length
        ? week.days.filter((day) => props.activeDays!.includes(day))
        : week.days;
}

function submit() {
    emit('submit', {
        startDate: startDate.value,
        endDate: endDate.value,
        reason: reason.value.trim() || null,
    });
}

/** Cleared by the parent after a successful write, so the form is reusable. */
function reset() {
    startDate.value = '';
    endDate.value = '';
    reason.value = '';
}

defineExpose({ reset });
</script>

<style scoped lang="scss">
.holiday {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);

    &_dates {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-4);
    }

    &_field {
        display: flex;
        flex: 1 1 180px;
        flex-direction: column;
        gap: var(--space-2);
    }

    &_label {
        font-size: var(--font-size-sm);
        font-weight: 650;
        color: $content4;
    }

    &_input {
        width: 100%;
        padding: 10px var(--space-5);
        border: 1px solid $content7;
        border-radius: var(--radius-lg);

        font-family: inherit;
        font-size: var(--font-size-md);
        color: $content3;

        background: $surface0;

        &:focus {
            border-color: $primary500;
            border-color: $primary600;
        }
    }

    &_preview {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);

        padding: var(--space-4) var(--space-5);
        border-radius: var(--radius-lg);

        background: $surface0;

        &-head {
            margin: 0;
            font-size: var(--font-size-sm);
            color: $content3;
        }
    }

    &_weeks {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);

        margin: 0;
        padding: 0;

        list-style: none;
    }

    &_week {
        font-size: var(--font-size-sm);
        font-variant-numeric: tabular-nums;
        color: $content7;

        // No longer a warning colour: a partial end week is the person's own
        // dates, honoured exactly, not an over-block to be disclosed (#118).
        &--partial {
            color: $content3;
        }
    }

    &_note {
        margin: 0;
        font-size: var(--font-size-sm);
        line-height: 1.5;
        color: $content7;

        &--warn {
            color: $warning800;
        }

        &--error {
            font-weight: 600;
            color: $error700;
        }
    }

    &_actions {
        display: flex;
        gap: var(--space-3);
    }
}
</style>
