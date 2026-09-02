<template>
    <section class="tray">
        <h2>
            <Icon
                name="material-symbols:report-outline"
                aria-hidden="true"
            />
            {{ t('schedule.offGrid.heading', { count: sessions.length }, sessions.length) }}
        </h2>

        <ul>
            <li
                v-for="session in sessions"
                :key="session.id"
            >
                <button
                    type="button"
                    @click="$emit('select', session.id)"
                >{{ sessionLabel(session) }}</button>
                <span>{{ offGridReason(grid, session, t) }}</span>
            </li>
        </ul>
    </section>
</template>

<script setup lang="ts">
import type { PlacedScheduleSession, TimeGrid } from '~/composables/schedule';
import { offGridReason, sessionLabel } from '~/composables/schedule';
import { useT } from '~/composables/i18n';

/**
 * Sessions the grid cannot position: a day the TimeGrid does not schedule, or
 * a block range running past the end of the day. Both are representable in the
 * schema (the CHECK only bounds 1-7 and >= 0), so a grid that positions by
 * index would drop them invisibly. They surface here instead.
 *
 * `PlacedScheduleSession`, not `ScheduleSession`: a banked Session (issue #22)
 * has no placement to be "outside the grid": it belongs to the spare bank
 * (`ScheduleSpareBank`), a different surfacing for a different reason.
 * `useScheduleData`'s `offGridSessions` already excludes it.
 */
defineProps<{
    sessions: PlacedScheduleSession[];
    grid: TimeGrid;
}>();

defineEmits<{ select: [sessionId: string] }>();

const { t } = useT();
</script>

<style scoped lang="scss">
@use '~/scss/schedule-panel' as *;

.tray {
    @include schedule-panel;
}
</style>
