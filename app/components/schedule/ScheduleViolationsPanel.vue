<template>
    <section class="panel">
        <div class="panel_head">
            <h2>Current violations</h2>

            <!--
                THE OFFER LIVES AT THE PROBLEM. `refreshViolations` runs inside
                every session mutation, so a clash is known the moment it is
                made — and this is where the person is already looking at it.
                Not a peer of "Generate schedule" in the toolbar: the
                one-active-run index means the two can never run together, so
                presenting them as siblings would misdescribe what they are.

                Gated on hard violations, not on any: a repair exists to make
                the timetable legal, and offering it against a soft preference
                breach would promise something it does not do.
            -->
            <CommonButton
                v-if="canRepair && hardCount > 0"
                type="secondary"
                @click="$emit('repair')"
            >
                <Icon
                    name="material-symbols:healing-outline"
                    aria-hidden="true"
                />
                Repair {{ hardCount }}
            </CommonButton>
        </div>

        <!--
            Said out loud rather than left to the button's absence, which reads
            identically to "there is nothing to fix".
        -->
        <p
            v-if="canRepair && hardCount > 0"
            class="panel_muted"
        >
            A repair moves as little as possible and produces a proposal to review —
            it never changes the timetable on its own.
        </p>

        <p
            v-if="!violations.length"
            class="panel_muted"
        >Nothing flagged in this view.</p>

        <ul v-else>
            <li
                v-for="violation in violations"
                :key="violation.id"
            >
                <!--
                    A session-scoped violation is a link to the chip that caused
                    it. An OFFERING-scoped one (ExactFrequency: "needs 6, placed
                    4") has no chip to select — the whole point is that the
                    sessions were never placed — so it renders as a statement
                    rather than a dead button.
                -->
                <button
                    v-if="violation.sessionId"
                    type="button"
                    @click="$emit('select', violation.sessionId)"
                >
                    <Icon
                        :name="violation.severity === 'HARD'
                            ? 'material-symbols:error'
                            : 'material-symbols:warning-outline'"
                        :class="violation.severity === 'HARD' ? 'is-hard' : 'is-soft'"
                        aria-hidden="true"
                    />
                    {{ sessionTitle(violation.sessionId) }}
                </button>

                <span
                    v-else
                    class="panel_unplaced"
                >
                    <Icon
                        :class="violation.severity === 'HARD' ? 'is-hard' : 'is-soft'"
                        name="material-symbols:event-busy-outline"
                        aria-hidden="true"
                    />
                    {{ subjectOf(violation) }}
                </span>

                <span>{{ describeViolation(violation, lookup) }}</span>
            </li>
        </ul>
    </section>
</template>

<script setup lang="ts">
import type { Violation } from '~/composables/schedule';
import { describeViolation } from '~/composables/schedule';
import CommonButton from '~/components/common/CommonButton.vue';

/**
 * The queryable half of warn-and-allow (TAXONOMY.md §3): a violation persists
 * after the edit that caused it, so it has to be findable without clicking
 * every session in the grid.
 */
const props = defineProps<{
    violations: Violation[];
    lookup: { room: (id: string) => string; person: (id: string) => string; group: (id: string) => string };
    sessionTitle: (id: string) => string;
    /** `solver.trigger`. Absent, never disabled — a control nobody can use is noise. */
    canRepair?: boolean;
}>();

defineEmits<{ select: [sessionId: string]; repair: [] }>();

/**
 * Counted from the SAME rows this panel renders, so the offer cannot promise a
 * number the list does not show. `preview.get.ts` reads the same
 * `constraint_violation` table for the review screen's baseline, which is what
 * keeps the offer and the review talking about one quantity.
 */
const hardCount = computed(() => props.violations.filter((v) => v.severity === 'HARD').length);

/**
 * What a row is ABOUT. A named function rather than the expression it replaces,
 * which ran `[code, title].filter(Boolean).join(' · ')` inside the `v-for` — so
 * once per violation on every render of the panel.
 *
 * Not a `computed`, because the value is per row rather than per component: a
 * computed would have to be a Map keyed by violation, and these rows have no
 * stable key of their own (an offering-scoped violation names no session).
 */
function subjectOf(violation: Violation): string {
    if (!violation.offering) {
        return 'Unplaced demand';
    }

    return [violation.offering.code, violation.offering.title].filter(Boolean).join(' · ');
}
</script>

<style scoped lang="scss">
@use '~/scss/schedule-panel' as *;

.panel {
    &_head {
        display: flex;
        gap: var(--space-4);
        align-items: center;
        justify-content: space-between;

        h2 { margin: 0; }
    }

    @include schedule-panel;

    h2 { color: $content6; }

    // Same shape as the session button minus the affordance: there is nothing
    // to navigate to, and a button that selects nothing is worse than text.
    &_unplaced {
        display: flex;
        gap: 5px; // Between space-2 (4px) and space-3 (6px) — hand-tuned, not on the scale.
        align-items: center;

        font-size: var(--font-size-sm);
        font-weight: 600;
        color: $content5;

        svg {
            width: 14px;
            height: 14px;
        }
    }
}
</style>
