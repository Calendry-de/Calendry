<template>
    <div class="agenda">
        <!--
            A week grid does not survive a phone, so the mobile presentation is a
            day agenda over the same data rather than a scaled-down grid. Days
            come from the TimeGrid, so this never assumes a five-day week either.
        -->
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
            THE MOBILE PRESENTATION HAS TO BE ABLE TO EDIT.

            Below 1365px — which includes an ordinary 1280px laptop — the week
            grid is hidden and this is the only surface. It had no cell targets,
            so pressing the inspector's "Move…" entered placement mode, rendered
            "Pick a slot… Press Escape to cancel", and offered nothing to pick.
            `Add event` was the same dead end.

            PRODUCT.md commits to genuine mobile and says a week grid on a phone
            "rules out drag-and-drop as the only editing gesture" — click-a-cell
            was desktop-only in exactly the same way. These are the same targets
            the grid emits, in the shape this presentation can carry: one row per
            block, stating its own clock time.
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
import type { ScheduleSession, TimeGrid, Violation } from '~/composables/schedule';
import type { DisplaySettings } from '#shared/sessionColor';
import { blockTime, weekdayName, weekdayShort } from '~/composables/schedule';
import ScheduleSessionChip from './ScheduleSessionChip.vue';

const props = defineProps<{
    grid: TimeGrid;
    sessions: ScheduleSession[];
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

const activeDay = ref(props.grid.activeDays[0] ?? 1);

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
    gap: 12px;
    width: 100%;

    &_days {
        overflow-x: auto;
        display: flex;
        gap: 4px;

        padding: 4px;
        border-radius: 8px;

        background: $surface1;
    }

    &_day {
        cursor: pointer;

        display: flex;
        flex: 1;
        gap: 5px;
        align-items: center;
        justify-content: center;

        // 44px: these tabs are the primary navigation of the presentation that
        // IS mobile below 1365px, and they are reached with a thumb. The rule
        // was written down and argued on the review agenda and applied only
        // there; this is the screen it was written for.
        min-width: 44px;
        min-height: 44px;
        padding: 8px 12px;
        border: 0;
        border-radius: 6px;

        font-family: inherit;
        font-size: 12.5px;
        font-weight: 600;
        color: $content6;

        background: none;

        &--active {
            color: $content2;
            background: varToRgba('primary500', 0.2);
        }

        &:focus-visible { outline: 2px solid $primary400; outline-offset: -2px; }
    }

    &_count {
        min-width: 17px;
        padding: 1px 4px;
        border-radius: 9px;

        font-size: 10.5px;
        font-variant-numeric: tabular-nums;
        color: $surface1;

        background: $content7;
    }

    /*
     * The placement targets. Full-width rows, 44px minimum, stating the clock
     * time they commit to — this is the primary editing gesture on the only
     * surface below 1365px, and it is reached with a thumb.
     */
    &_targets {
        display: flex;
        flex-direction: column;
        gap: 8px;

        margin: 0;
        padding: 0;

        list-style: none;
    }

    &_target {
        cursor: pointer;

        display: flex;
        gap: 12px;
        align-items: center;
        justify-content: space-between;

        width: 100%;
        min-height: 52px;
        padding: 10px 12px;
        border: 1px dashed $primary600;
        border-radius: 8px;

        font-family: inherit;
        font-size: 13px;
        color: $content2;

        background: varToRgba('primary500', 0.08);

        @include hover() {
            &:hover { background: varToRgba('primary500', 0.16); }
        }
    }

    &_target-time {
        display: flex;
        flex: none;
        gap: 6px;
        align-items: baseline;

        font-weight: 600;
        font-variant-numeric: tabular-nums;
    }

    &_target-verb {
        display: flex;
        gap: 6px;
        align-items: center;
        color: $primary700;

        svg { width: 15px; height: 15px; }
    }

    &_empty {
        margin: 0;
        padding: 28px 0;

        font-size: 13px;
        color: $content7;
        text-align: center;
    }

    &_list {
        display: flex;
        flex-direction: column;
        gap: 8px;

        margin: 0;
        padding: 0;

        list-style: none;

        li {
            display: grid;
            grid-template-columns: 58px 1fr;
            gap: 10px;
            align-items: stretch;

            min-height: 58px;
        }
    }

    &_time {
        display: flex;
        flex-direction: column;
        gap: 2px;

        padding-top: 7px;

        font-size: 12px;
        font-variant-numeric: tabular-nums;
        color: $content6;
        text-align: right;

        &-end {
            font-size: 11px;
            color: $content7;
        }
    }
}
</style>
