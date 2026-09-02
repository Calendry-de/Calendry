<template>
    <div class="mini">
        <div class="mini_head">
            <button
                type="button"
                class="mini_step"
                aria-label="Previous month"
                @click="shiftMonth(-1)"
            >
                <Icon
                    name="material-symbols:chevron-left"
                    aria-hidden="true"
                />
            </button>

            <p class="mini_label">{{ monthLabel }}</p>

            <button
                type="button"
                class="mini_step"
                aria-label="Next month"
                @click="shiftMonth(1)"
            >
                <Icon
                    name="material-symbols:chevron-right"
                    aria-hidden="true"
                />
            </button>
        </div>

        <div
            class="mini_weekdays"
            aria-hidden="true"
        >
            <span
                v-for="iso in 7"
                :key="iso"
            >{{ weekdayShort(iso) }}</span>
        </div>

        <div
            class="mini_grid"
            role="grid"
            :aria-label="monthLabel"
        >
            <button
                v-for="cell in cells"
                :key="cell.iso"
                type="button"
                role="gridcell"
                class="mini_day"
                :class="{
                    'mini_day--out': !cell.inMonth,
                    'mini_day--selected': cell.termWeek === week,
                    'mini_day--today': cell.isToday,
                }"
                :disabled="!cell.inTerm"
                :aria-current="cell.isToday ? 'date' : undefined"
                :aria-label="`${cell.label}, week ${cell.termWeek}${cell.termWeek === week ? ' (current)' : ''}`"
                @click="$emit('select-week', cell.termWeek)"
            >{{ cell.date.getUTCDate() }}</button>
        </div>
    </div>
</template>

<script setup lang="ts">
import type { Term } from '~/composables/schedule';
import { weekdayShort } from '~/composables/schedule';
import { addDays, isoDate, mondayOf, weekIndexOf } from '#shared/academicCalendar';

/**
 * A "jump to a date" tool, secondary to `ScheduleWeekNav`'s prev/next stepper:
 * it does not replace it. Every date-to-week conversion goes through
 * `shared/academicCalendar.ts`, the one definition also used by the solver's
 * calendar and the calendar-period editor; no date arithmetic is reinvented
 * here.
 */
const props = defineProps<{
    term: Term | null;
    /** 1-based, matching `useScheduleFilters().week` and `slotDate()`. */
    week: number;
    totalWeeks: number;
}>();

defineEmits<{ 'select-week': [week: number] }>();

const termStart = computed(() => (props.term ? new Date(props.term.startDate) : null));

/**
 * The month on screen, independent of the term's own start: a reader jumping
 * a few months ahead should not have their place reset by an unrelated prop
 * change. Re-seeded only when the TERM itself changes (a different Term's
 * dates make the old viewed month meaningless), never on every `week` step.
 */
const viewedMonth = ref(monthOf(initialDate()));

function initialDate(): Date {
    if (!termStart.value) return new Date();

    return addDays(mondayOf(termStart.value), (props.week - 1) * 7);
}

function monthOf(date: Date): { year: number; month: number } {
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}

watch(() => props.term?.id, () => {
    viewedMonth.value = monthOf(initialDate());
});

function shiftMonth(by: number) {
    const { year, month } = viewedMonth.value;
    const next = new Date(Date.UTC(year, month + by, 1));

    viewedMonth.value = monthOf(next);
}

const monthLabel = computed(() => new Intl.DateTimeFormat(undefined, {
    month: 'long', year: 'numeric', timeZone: 'UTC',
}).format(new Date(Date.UTC(viewedMonth.value.year, viewedMonth.value.month, 1))));

interface Cell {
    date: Date;
    iso: string;
    label: string;
    inMonth: boolean;
    inTerm: boolean;
    termWeek: number;
    isToday: boolean;
}

/**
 * A fixed 42-cell (6-week) grid, Monday-anchored, covering the viewed month:
 * the conventional month-picker shape, never resized by how many weeks a
 * given month happens to span.
 */
const cells = computed<Cell[]>(() => {
    const start = props.term ? termStart.value! : new Date();
    const firstOfMonth = new Date(Date.UTC(viewedMonth.value.year, viewedMonth.value.month, 1));
    const gridStart = mondayOf(firstOfMonth);
    const today = isoDate(new Date());

    return Array.from({ length: 42 }, (_, i) => {
        const date = addDays(gridStart, i);
        const index = props.term ? weekIndexOf(start, date) : -1;
        const termWeek = index + 1;

        return {
            date,
            iso: isoDate(date),
            label: new Intl.DateTimeFormat(undefined, {
                weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
            }).format(date),
            inMonth: date.getUTCMonth() === viewedMonth.value.month,
            inTerm: termWeek >= 1 && termWeek <= props.totalWeeks,
            termWeek,
            isToday: isoDate(date) === today,
        };
    });
});
</script>

<style scoped lang="scss">
.mini {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);

    &_head {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    &_step {
        cursor: pointer;

        display: flex;
        align-items: center;
        justify-content: center;

        width: 32px;
        height: 32px;
        border: 0;
        border-radius: var(--radius-md);

        color: $content6;

        background: none;

        transition: background 140ms cubic-bezier(0.16, 1, 0.3, 1),
            color 140ms cubic-bezier(0.16, 1, 0.3, 1);

        svg {
            width: 18px;
            height: 18px;
        }

        @include hover() {
            &:hover {
                color: $content1;
                background: varToRgba('primary500', 0.12);
            }
        }

        &:focus-visible {
            outline: 2px solid $primary600;
            outline-offset: 1px;
        }
    }

    &_label {
        margin: 0;

        font-size: var(--font-size-sm);
        font-weight: 650;
        color: $content2;
        text-align: center;
    }

    &_weekdays {
        display: grid;
        grid-template-columns: repeat(7, 1fr);

        span {
            font-size: var(--font-size-xs);
            font-weight: 600;
            color: $content7;
            text-align: center;
            text-transform: uppercase;
        }
    }

    &_grid {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 2px;
    }

    &_day {
        cursor: pointer;

        display: flex;
        align-items: center;
        justify-content: center;

        aspect-ratio: 1;
        border: 0;
        border-radius: var(--radius-sm);

        font-family: inherit;
        font-size: var(--font-size-sm);
        font-variant-numeric: tabular-nums;
        color: $content4;

        background: none;

        transition: background 140ms cubic-bezier(0.16, 1, 0.3, 1);

        &--out { color: $surface6; }

        // The whole week reads as a band. `varToRgba('primary500', 0.14)`,
        // not the flat `primary200` this used to be: `primary200` is a LIGHT-
        // ONLY tint with no dark-theme override, while `primary700` (the text
        // sitting on top of it) DOES flip to a light value in dark mode,
        // meaning light text on a background that stayed light regardless of
        // theme, which is exactly the low-contrast selected-week band reported
        // live. `primary500` at low opacity is the pattern every OTHER
        // "selected/highlighted" surface in this app already uses (`ManageList`,
        // `ScheduleGrid`, `ManageConstraintVariantGroup`, …) because it is
        // translucent over whatever ground sits under it, light in light
        // mode, dark in dark mode, so it composes correctly with
        // `primary700`'s own per-theme flip instead of fighting it.
        &--selected {
            font-weight: 650;
            color: $primary700;
            background: varToRgba('primary500', 0.14);
        }

        &--today:not(&--selected) {
            box-shadow: inset 0 0 0 1px $primary500;
        }

        &:disabled {
            cursor: default;
            color: $surface5;
        }

        @include hover() {
            &:hover:not(:disabled) {
                background: $surface2;
            }
        }

        &:focus-visible {
            outline: 2px solid $primary600;
            outline-offset: -2px;
        }
    }
}
</style>
