<template>
    <!--
        What is waiting for a decision, as opposed to what the institution IS.

        A SECOND, LABELLED FAMILY rather than more tiles on the counts strip.
        The strip below states shape (persons, rooms, offerings) and is true
        whether or not anybody is looking; these are about NOW. Two strips of
        identical unlabelled tiles would have read as one long strip of facts
        of one kind, which is exactly the flattening this page's old
        24-identical-cards grid was rewritten to undo, so this family gets the
        11px uppercase heading register the page's own group headings use.

        THIS IS THE PAGE'S PROMOTED STRIP, and the promotion is spent here
        rather than taken from the type scale: these tiles keep the 24px value
        they always had and the counts strip dropped to 17px with tighter
        padding, so the two now differ by SIZE as well as by heading. Size is
        the only hierarchy cue that survives a calm day, when every queue is
        at zero and the accent is correctly absent.

        Same tile grammar otherwise (no card boxes, the 1px `gap` showing
        `$surface4` through as an exact hairline), because these ARE counts and
        inventing a second tile shape for them would say they are a different
        kind of object rather than a different kind of fact.
    -->
    <section
        v-if="pending || queues.length"
        class="queues"
    >
        <h2 class="queues_heading">{{ t('dashboard.reviewQueues.heading') }}</h2>

        <div
            v-if="pending"
            class="queues_grid"
            aria-hidden="true"
        >
            <!--
                Skeleton in the FINAL SHAPE, same as the counts strip: same
                tile count, same two-line stack, so nothing resizes when the
                numbers land. `aria-hidden` because placeholder tiles are worth
                nothing to a screen reader.
            -->
            <div
                v-for="index in skeletonCount"
                :key="index"
                class="queues_tile queues_tile--skeleton"
            >
                <span class="queues_skeleton queues_skeleton--value"/>
                <span class="queues_skeleton queues_skeleton--label"/>
            </div>
        </div>

        <div
            v-else
            class="queues_grid"
        >
            <NuxtLink
                v-for="queue in queues"
                :key="queue.key"
                class="queues_tile"
                :class="{ 'queues_tile--waiting': isWaiting(queue) }"
                :to="queue.to"
                :aria-label="accessibleName(queue)"
            >
                <!--
                    THREE STATES, THREE RENDERINGS, which is the whole reason
                    this tile is not a plain number:

                      absent       the caller may not read this queue, so
                                   `reviewQueues()` never returned it and there
                                   is no tile at all
                      "Unavailable"  the request failed; a word, never 0 and
                                   never a dash
                      a numeral    a real answer, and 0 is a real answer

                    Reusing `dashboard.counts.unavailable` rather than a second
                    key: it is the same word for the same fact, and two
                    translations of one word is how two surfaces come to
                    disagree. The FULLER sentence (which queue, and that it
                    could not be read) is on the link's accessible name, where
                    there is room for it.
                -->
                <span
                    v-if="queue.total === null"
                    class="queues_value queues_value--unavailable"
                >{{ t('dashboard.counts.unavailable') }}</span>
                <span
                    v-else
                    class="queues_value"
                >{{ queue.total.toLocaleString() }}</span>

                <span class="queues_label">{{ t(queue.labelKey) }}</span>
            </NuxtLink>
        </div>
    </section>
</template>

<script setup lang="ts">
import type { ReviewQueueCount } from '~/utils/reviewQueues';
import { REVIEW_QUEUES } from '~/utils/reviewQueues';
import { useT } from '~/composables/i18n';

/**
 * Presentation only. The fetch lives in `useReviewQueueCounts()` and the page
 * holds the await, so this component owns no boundary and renders whatever it
 * is handed, including the failed-tile case.
 */
const props = defineProps<{
    queues: readonly ReviewQueueCount[];
    pending?: boolean;
}>();

const { t } = useT();

/*
 * The module's own ceiling, READ FROM IT rather than written here as a number:
 * a queue added to `REVIEW_QUEUES` would otherwise leave the skeleton one tile
 * short forever, and nothing would report it. On a first load there is no
 * resolved list to measure, so the skeleton cannot derive its length from
 * `queues`; once a length is known it is used, which keeps a client-side
 * refresh from changing the strip's width mid-flight.
 */
const skeletonCount = computed(() => (props.queues.length > 0 ? props.queues.length : REVIEW_QUEUES.length));

/**
 * Whether this tile is asking for the reader's attention.
 *
 * `> 0` and nothing else: `null` is a failed request, which is a problem with
 * the dashboard rather than something waiting in the institution, and colouring
 * it as a signal would send somebody to a queue that may well be empty.
 */
function isWaiting(queue: ReviewQueueCount): boolean {
    return queue.total !== null && queue.total > 0;
}

/**
 * The link's accessible name: a whole sentence, not the numeral plus an
 * uppercase fragment.
 *
 * "3" followed by "PLAN PROPOSALS" is legible to an eye scanning a grid and
 * meaningless read aloud in sequence, and the visible label deliberately omits
 * "waiting for a decision" because the section heading above already says it
 * once for the whole family. The sentence puts it back for a reader who
 * arrives at the link without the heading.
 *
 * PLURAL FORMS OF ONE MESSAGE (`zero | one | other`), per
 * `i18n/CONVENTIONS.md`, never a suffix patched onto a word: German has no
 * `-s` plural, and the zero form ("No plan proposals are waiting") reads as
 * prose rather than as "0 plan proposals".
 */
function accessibleName(queue: ReviewQueueCount): string {
    return queue.total === null
        ? t(queue.unavailableKey)
        : t(queue.sentenceKey, queue.total);
}
</script>

<style scoped lang="scss">
.queues {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);

    /*
     * The 11px uppercase label register DESIGN.md reserves for group headings,
     * and the same one the sidebar's own headings use. An `h2` because this is
     * a real section of the page and belongs in the document outline.
     */
    &_heading {
        margin: 0;
        padding: 0 var(--space-5);

        font-size: var(--font-size-xs);
        font-weight: 650;
        color: $content7;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    /*
     * GAP AS HAIRLINE, exactly as the counts strip: the 1px gap reveals the
     * container's `$surface4` between tiles, so separators land on the grid in
     * any wrap configuration without a border declaration.
     */
    &_grid {
        overflow: hidden;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 1px;

        background: $surface4;

        @include mobile() {
            grid-template-columns: repeat(2, 1fr);
        }
    }

    &_tile {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);

        padding: var(--space-5) var(--space-6);

        text-decoration: none;

        background: $surface1;

        transition: 0.15s;

        @include hover() {
            &:hover {
                background: $surface2;
            }
        }

        &--skeleton {
            cursor: default;
        }

        /*
         * THE ONE PLACE ON THIS PAGE THAT SPENDS THE ACCENT, and it spends it
         * on exactly what DESIGN.md says the accent means: "Signal Teal appears
         * only where the system is offering the viewer something to act on."
         * A non-empty review queue IS that, and it is the first count on
         * `/dashboard` with a state at all: a room count is never good or bad,
         * while "4 proposals waiting" is a request.
         *
         * Not `error`/`warning`: a proposal awaiting review is the system
         * working, not a fault, and red would make an ordinary Tuesday look
         * like an incident. Not a badge, not a dot, not a filled tile: the
         * NUMERAL carries it, so the accent appears at most twice on the page
         * and only when there is something behind it. At zero this class is
         * absent and the tile is the colourless one, which is the honest
         * drawing of "nothing is asking for you".
         *
         * `$primary600` rather than `$primary500`: `layout.scss` records the
         * measurement, 4.51:1 on the light ground, where `$primary400` is
         * 2.31:1. The Measured-Contrast Rule wants a number, not a glance.
         */
        &--waiting .queues_value {
            color: $primary600;
        }
    }

    &_value {
        /*
         * `--font-size-xl` (24px), the page-title register, against the counts
         * strip's 17px. THE ONE PROMOTED NUMBER on this page: it is the answer
         * to "what should I do now", and DESIGN.md's next step up is the 32px
         * display size, which on a cockpit surface reads as a marketing page.
         *
         * TABULAR NUMERALS, per DESIGN.md: these change in place on refresh,
         * and proportional digits make the strip shiver as they do.
         */
        font-size: var(--font-size-xl);
        font-weight: 650;
        font-variant-numeric: tabular-nums;
        line-height: var(--leading-tight);
        color: $content1;

        &--unavailable {
            font-size: var(--font-size-sm);
            font-weight: 400;
            color: $content7;
        }
    }

    &_label {
        font-size: var(--font-size-xs);
        font-weight: 650;
        color: $content7;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    // A still block at the value's own height, not a shimmer: reserving the
    // space is the whole job, and it costs no frames on the first paint.
    &_skeleton {
        border-radius: var(--radius-sm);
        background: $surface3;

        &--value {
            width: 2.5ch;
            height: var(--font-size-xl);
        }

        &--label {
            width: 9ch;
            height: var(--font-size-xs);
        }
    }
}
</style>
