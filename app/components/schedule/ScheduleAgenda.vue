<template>
    <div class="agenda">
        <!-- A week grid does not survive a phone, so the mobile presentation is
             a day agenda over the same data. Days come from the TimeGrid, so this
             never assumes a five-day week. -->
        <div
            class="agenda_days"
            role="tablist"
            aria-label="Day"
        >
            <button
                v-for="day in grid.activeDays"
                :key="day"
                type="button"
                role="tab"
                class="agenda_day"
                :class="{ 'agenda_day--active': day === activeDay }"
                :aria-selected="day === activeDay"
                @click="activeDay = day"
            >
                <span>{{ weekdayShort(day) }}</span>
                <span
                    v-if="countFor(day)"
                    class="agenda_count"
                >{{ countFor(day) }}</span>
            </button>
        </div>

        <!--
            THE MOBILE PRESENTATION HAS TO BE ABLE TO EDIT. Below 1365px — which
            includes an ordinary 1280px laptop — this is the only surface, and
            without cell targets "Move…" entered placement mode and offered
            nothing to pick. Same targets the grid emits, in the shape this
            presentation can carry.
        -->
        <ol
            v-if="placing"
            class="agenda_targets"
        >
            <li
                v-for="block in grid.blocksPerDay"
                :key="`t-${block}`"
            >
                <button
                    type="button"
                    class="agenda_target"
                    :aria-label="`${targetVerb ?? 'Move to'} ${weekdayName(activeDay)} `
                        + blockTime(grid, block - 1, activeDay).start"
                    @click="$emit('place', { dayOfWeek: activeDay, blockIndex: block - 1 })"
                >
                    <span class="agenda_target-time">
                        {{ blockTime(grid, block - 1, activeDay).start }}
                        <span class="agenda_time-end">{{ blockTime(grid, block - 1, activeDay).end }}</span>
                    </span>
                    <span class="agenda_target-verb">
                        <Icon
                            name="material-symbols:add-circle-outline"
                            aria-hidden="true"
                        />
                        {{ targetVerb ?? 'Move to' }} this block
                    </span>
                </button>
            </li>
        </ol>

        <p
            v-else-if="!daySessions.length"
            class="agenda_empty"
        >Nothing scheduled on {{ weekdayName(activeDay) }}.</p>

        <ol
            v-else
            class="agenda_list"
        >
            <li
                v-for="session in daySessions"
                :key="session.id"
            >
                <span class="agenda_time">
                    {{ blockTime(grid, session.blockIndex, session.dayOfWeek).start }}
                    <span class="agenda_time-end">{{
                        blockTime(grid, session.blockIndex + session.durationBlocks - 1, session.dayOfWeek).end
                    }}</span>
                </span>

                <ScheduleSessionChip
                    :grid="grid"
                    :room-name="roomName"
                    :virtual-room-ids="virtualRoomIds"
                    :display="display"
                    :group-name="groupName"
                    :person-name="personName"
                    :show-group="showGroup"
                    :show-person="showPerson"
                    :session="session"
                    :violations="violations.get(session.id) ?? []"
                    :selected="session.id === selectedId"
                    :dimmed="false"
                    @select="$emit('select', session.id)"
                />
            </li>
        </ol>
    </div>
</template>

<script setup lang="ts">
import type { PlacedScheduleSession, TimeGrid, Violation } from '~/composables/schedule';
import type { DisplaySettings } from '#shared/sessionColor';
import { blockTime, weekdayName, weekdayShort } from '~/composables/schedule';
import ScheduleSessionChip from './ScheduleSessionChip.vue';

const props = defineProps<{
    grid: TimeGrid;
    /** Placed only (issue #22) — a banked Session has no day to fall under. */
    sessions: PlacedScheduleSession[];
    violations: Map<string, Violation[]>;
    selectedId: string | null;
    /** Blocks become targets, exactly as the grid's cells do. */
    placing?: boolean;
    /** "Move to" or "Add event at" — the same promise the grid makes. */
    targetVerb?: string;
    roomName?: (id: string) => string;
    virtualRoomIds?: Set<string>;
    display?: DisplaySettings;
    groupName?: (id: string) => string;
    personName?: (id: string) => string;
    showGroup?: boolean;
    showPerson?: boolean;
}>();

defineEmits<{
    select: [sessionId: string];
    place: [target: { dayOfWeek: number; blockIndex: number }];
}>();

/**
 * Opens on the SELECTED session's day, not on Monday. Both presentations are
 * always in the DOM and the 1365px swap is a `display` toggle, so crossing the
 * breakpoint always landed on `activeDays[0]` — the inspector said Friday while
 * the agenda said Monday.
 */
const activeDay = ref(props.grid.activeDays[0] ?? 1);

watch(() => props.sessions.find((session) => session.id === props.selectedId)?.dayOfWeek,
    (day) => {
        if (day !== undefined && props.grid.activeDays.includes(day)) {
            activeDay.value = day;
        }
    },
    { immediate: true });

const daySessions = computed(() => props.sessions
    .filter((s) => s.dayOfWeek === activeDay.value)
    .sort((a, b) => a.blockIndex - b.blockIndex));

function countFor(day: number): number {
    return props.sessions.filter((s) => s.dayOfWeek === day).length;
}
</script>

<style scoped lang="scss">
.agenda {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    width: 100%;

    &_days {
        overflow-x: auto;
        display: flex;
        gap: var(--space-2);

        padding: var(--space-2);
        border-radius: var(--radius-lg);

        background: $surface1;
    }

    &_day {
        cursor: pointer;

        display: flex;
        flex: 1;
        gap: 5px; // Between space-2 (4px) and space-3 (6px) — hand-tuned, not on the scale.
        align-items: center;
        justify-content: center;

        // 44px: these tabs are the primary navigation of the presentation that
        // IS mobile below 1365px, and they are reached with a thumb. The rule
        // was written down and argued on the review agenda and applied only
        // there; this is the screen it was written for.
        min-width: 44px;
        min-height: 44px;
        padding: var(--space-4) var(--space-5);
        border: 0;
        border-radius: var(--radius-md);

        font-family: inherit;
        font-size: var(--font-size-sm);
        font-weight: 600;
        color: $content6;

        background: none;

        &--active {
            color: $content2;
            background: varToRgba('primary500', 0.2);
        }

        &:focus-visible {
            outline: 2px solid $primary400;
            outline-offset: -2px;
        }
    }

    &_count {
        min-width: 17px;
        padding: 1px 4px; // 1px is a hairline on a small badge; kept together rather than half-tokenized.
        border-radius: 9px; // Half the 17px min-width — a circular badge, not a scale step.

        font-size: var(--font-size-xs);
        font-variant-numeric: tabular-nums;
        color: $surface1;

        background: $content7;
    }

    /* The placement targets: full-width rows, 44px minimum, stating the clock
       time they commit to. The primary editing gesture below 1365px. */
    &_targets {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);

        margin: 0;
        padding: 0;

        list-style: none;
    }

    &_target {
        cursor: pointer;

        display: flex;
        gap: var(--space-5);
        align-items: center;
        justify-content: space-between;

        width: 100%;
        min-height: 52px;
        padding: 10px 12px; // 10px has no scale match; kept together rather than half-tokenized.
        border: 1px dashed $primary600;
        border-radius: var(--radius-lg);

        font-family: inherit;
        font-size: var(--font-size-md);
        color: $content2;

        background: varToRgba('primary500', 0.08);

        @include hover() {
            &:hover { background: varToRgba('primary500', 0.16); }
        }
    }

    &_target-time {
        display: flex;
        flex: none;
        gap: var(--space-3);
        align-items: baseline;

        font-weight: 600;
        font-variant-numeric: tabular-nums;
    }

    &_target-verb {
        display: flex;
        gap: var(--space-3);
        align-items: center;
        color: $primary700;

        svg {
            width: 15px;
            height: 15px;
        }
    }

    &_empty {
        margin: 0;
        padding: 28px 0; // Between space-7 (24px) and space-8 (32px) — hand-tuned, not on the scale.

        font-size: var(--font-size-md);
        color: $content7;
        text-align: center;
    }

    &_list {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);

        margin: 0;
        padding: 0;

        list-style: none;

        li {
            display: grid;

            /* `minmax(0, 1fr)`, not `1fr`: a track's default minimum is its
               min-content width, so a long title pushed the track wider than its
               share and the row overflowed instead of ellipsising. */
            grid-template-columns: 58px minmax(0, 1fr);
            gap: var(--space-4);
            align-items: stretch;

            min-height: 58px;
        }
    }

    &_time {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);

        padding-top: 7px;

        font-size: var(--font-size-sm);
        font-variant-numeric: tabular-nums;
        color: $content6;
        text-align: right;

        &-end {
            font-size: var(--font-size-xs);
            color: $content7;
        }
    }
}
</style>
