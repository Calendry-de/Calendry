<template>
    <section class="bank">
        <h2>
            <Icon
                name="material-symbols:inventory-2-outline"
                aria-hidden="true"
            />
            {{ t('schedule.spareBank.heading', { count: sessions.length }, sessions.length) }}
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
                <span>{{ t('schedule.spareBank.owedBy', {
                    offering: session.offering?.title ?? t('schedule.spareBank.owedByFallback'),
                }) }}</span>
            </li>
        </ul>
    </section>
</template>

<script setup lang="ts">
import type { ScheduleSession } from '~/composables/schedule';
import { sessionLabel } from '~/composables/schedule';
import { useT } from '~/composables/i18n';

/**
 * Cancelled Sessions with nowhere to sit (issue #22): still counted toward
 * their Offering's frequency, still carrying their Groups/People/Rooms, but
 * banked rather than placed. Read-only, like `ScheduleOffGridTray`: selecting
 * one shows it in the Inspector, whose existing "Move…" action (relabelled
 * "Place…" for a banked subject) is the whole restore path; this list does
 * not duplicate that machinery.
 */
defineProps<{
    sessions: ScheduleSession[];
}>();

defineEmits<{ select: [sessionId: string] }>();

const { t } = useT();
</script>

<style scoped lang="scss">
@use '~/scss/schedule-panel' as *;

.bank {
    @include schedule-panel;
}
</style>
