<template>
    <div class="blockday">
        <!--
            Hidden without `availability.manage_own`, not disabled. ITS OWN
            gate, deliberately separate from whatever let this page load: the
            page itself is reachable on `session.read` OR `session.read_own`,
            neither of which says anything about whether this account may
            declare unavailability. Riding on the page's gate would offer this
            to exactly the timetablers who don't need it and hide it from the
            lecturers who do (issue #2).
        -->
        <CommonButton
            v-if="canManageOwn"
            icon="material-symbols:event-busy-outline"
            type="transparent"
            @click="open = !open"
        >I can't teach this week</CommonButton>

        <!--
            ANCHORED, not in flow — the toolbar's height is invariant
            (CLAUDE.md, "The schedule toolbar"), matching how the solver
            control's own tall states are positioned.
        -->
        <div
            v-if="open"
            class="blockday_panel"
            role="dialog"
            aria-label="Declare a day you cannot teach"
        >
            <p class="blockday_help">
                Pick a day in the week you're viewing.
                <strong>This is submitted for approval</strong>, not applied
                immediately — a declared day is a hard rule for the scheduler,
                so it is reviewed first.
            </p>

            <div class="blockday_days">
                <button
                    v-for="day in days"
                    :key="day.iso"
                    class="blockday_day"
                    :class="{ 'blockday_day--selected': day.iso === selected }"
                    :disabled="busy"
                    type="button"
                    @click="selected = day.iso"
                >
                    <span class="blockday_weekday">{{ day.label }}</span>
                    <span class="blockday_date">{{ day.dateLabel }}</span>
                </button>
            </div>

            <label class="blockday_field">
                <span class="sr-only">Reason (optional)</span>
                <input
                    v-model="reason"
                    :disabled="busy"
                    maxlength="500"
                    placeholder="Reason (optional)"
                    type="text"
                >
            </label>

            <p
                v-if="error"
                class="blockday_error"
                role="alert"
            >{{ error }}</p>
            <p
                v-if="submitted"
                class="blockday_submitted"
                role="status"
            >Submitted — waiting for a decision.</p>

            <div class="blockday_actions">
                <CommonButton
                    :disabled="!selected || busy"
                    type="primary"
                    @click="submit"
                >{{ busy ? 'Sending…' : 'Submit' }}</CommonButton>
                <CommonButton
                    type="secondary"
                    @click="open = false"
                >Close</CommonButton>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { isoDate } from '#shared/academicCalendar';
import { weekdayName } from '~/composables/schedule';
import { useHasPermission } from '~/composables/session';

/**
 * "I cannot teach this day" — issue #2. A lecturer declares a single date's
 * unavailability from the schedule they are already looking at, instead of
 * navigating to `/my/availability` and re-finding it there.
 *
 * REUSES THE EXISTING WRITE PATH, unchanged in shape: this sends
 * `{ date, reason }` to `POST /api/me/availability/vetoes`, the same route
 * `/my/availability`'s recurring-pattern form uses — an affordance in a
 * different place, not a second way to write availability.
 */
const props = defineProps<{
    week: number;
    activeDays: number[];
    slotDateOf: (week: number, dayOfWeek: number) => Date | null;
}>();

const canManageOwn = useHasPermission('availability.manage_own');
const request = useRequestFetch();

const open = ref(false);
const selected = ref('');
const reason = ref('');
const busy = ref(false);
const error = ref('');
const submitted = ref(false);

const days = computed(() => props.activeDays.map((dow) => {
    const date = props.slotDateOf(props.week, dow);

    return {
        iso: date ? isoDate(date) : '',
        label: weekdayName(dow),
        dateLabel: date ? date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '',
    };
}).filter((day) => day.iso));

watch(() => props.week, () => {
    selected.value = '';
    submitted.value = false;
});

async function submit() {
    if (!selected.value) {
        return;
    }

    busy.value = true;
    error.value = '';

    try {
        await request('/api/me/availability/vetoes', {
            method: 'POST',
            body: { date: selected.value, reason: reason.value || null },
        });

        submitted.value = true;
        selected.value = '';
        reason.value = '';
    } catch (cause) {
        error.value = (cause as { statusMessage?: string })?.statusMessage
            ?? 'Could not submit that.';
    } finally {
        busy.value = false;
    }
}
</script>

<style scoped lang="scss">
.blockday {
    position: relative;

    &_panel {
        position: absolute;
        z-index: 20;
        top: calc(100% + var(--space-2));
        right: 0;

        display: flex;
        flex-direction: column;
        gap: var(--space-4);

        width: 320px;
        padding: var(--space-5);
        border: 1px solid $surface4;
        border-radius: var(--radius-xl);

        background: $surface0;
        box-shadow: 0 8px 24px rgb(0, 0, 0, 0.16);
    }

    &_help {
        margin: 0;
        font-size: var(--font-size-sm);
        line-height: 1.5;
        color: $content7;
    }

    &_days {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
        gap: var(--space-2);
    }

    &_day {
        cursor: pointer;

        display: flex;
        flex-direction: column;
        gap: var(--space-1);
        align-items: center;

        padding: var(--space-2) var(--space-3);
        border: 1px solid $surface4;
        border-radius: var(--radius-lg);

        font-family: inherit;
        color: $content4;

        background: $surface1;

        &--selected {
            border-color: $primary500;
            color: $primary700;
            background: varToRgba('primary500', 0.1);
        }

        &:disabled {
            cursor: default;
            opacity: 0.6;
        }
    }

    &_weekday {
        font-size: var(--font-size-xs);
        font-weight: 650;
    }

    &_date {
        font-size: var(--font-size-xs);
        color: $content7;
    }

    &_field input {
        width: 100%;
        padding: var(--space-3) var(--space-4);
        border: 1px solid $surface4;
        border-radius: var(--radius-lg);

        font-family: inherit;
        font-size: var(--font-size-sm);
        color: $content4;

        background: $surface1;
    }

    &_error {
        margin: 0;
        padding: var(--space-2) var(--space-4);
        border-radius: var(--radius-lg);

        font-size: var(--font-size-sm);
        color: $error700;

        background: varToRgba('error500', 0.14);
    }

    &_submitted {
        margin: 0;
        padding: var(--space-2) var(--space-4);
        border-radius: var(--radius-lg);

        font-size: var(--font-size-sm);
        color: $success700;

        background: varToRgba('success500', 0.14);
    }

    &_actions {
        display: flex;
        gap: var(--space-2);
    }
}

.sr-only {
    position: absolute;

    overflow: hidden;

    width: 1px;
    height: 1px;

    clip-path: inset(50%);
}
</style>
