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

        <!--
            ONE LINE, NOT A ROW OF TILES. Three tiles of 24px numerals over
            uppercase captions cost ~80px and, on the ordinary day when every
            queue is at zero, said "0 0 0" in the largest type on the page.
            Inline, each queue is a short phrase ("3 plan proposals") that a
            reader scans left to right, and the strip is one text line tall.
            The heading sits in a fixed column shared with the counts row
            below, so the two facts rows align like a table.

            Skeleton in the FINAL SHAPE: same item count, same value+label
            pair, so nothing shifts when the numbers land. `aria-hidden`
            because placeholders are worth nothing to a screen reader.
        -->
        <ul
            v-if="pending"
            class="queues_list"
            aria-hidden="true"
        >
            <li
                v-for="index in skeletonCount"
                :key="index"
                class="queues_item queues_item--skeleton"
            >
                <span class="queues_skeleton queues_skeleton--value"/>
                <span class="queues_skeleton queues_skeleton--label"/>
            </li>
        </ul>

        <ul
            v-else
            class="queues_list"
        >
            <li
                v-for="queue in queues"
                :key="queue.key"
            >
                <NuxtLink
                    class="queues_item"
                    :class="{ 'queues_item--waiting': isWaiting(queue) }"
                    :to="queue.to"
                    :aria-label="accessibleName(queue)"
                >
                    <!--
                        THREE STATES, THREE RENDERINGS, which is the whole
                        reason this is not a plain number:

                          absent         the caller may not read this queue, so
                                         `reviewQueues()` never returned it
                          "Unavailable"  the request failed; a word, never 0
                                         and never a dash
                          a numeral      a real answer, and 0 is a real answer

                        Reusing `dashboard.counts.unavailable` rather than a
                        second key: same word for the same fact. The FULLER
                        sentence is on the link's accessible name.
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
            </li>
        </ul>
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
/*
 * A FACTS ROW: heading column, then the items inline. The column width is
 * shared with `InstitutionCounts` (same value, by hand) so the two rows the
 * dashboard stacks read as one small table rather than two unrelated strips.
 */
.queues {
    display: grid;
    grid-template-columns: minmax(8rem, 11rem) minmax(0, 1fr);
    gap: var(--space-3) var(--space-6);
    align-items: baseline;

    @include mobile() {
        grid-template-columns: minmax(0, 1fr);
    }

    /* The 11px uppercase label register the sidebar's headings use. An `h2`
       because this is a real section and belongs in the document outline. */
    &_heading {
        margin: 0;

        font-size: var(--font-size-xs);
        font-weight: 650;
        color: $content7;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    &_list {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2) var(--space-6);

        margin: 0;
        padding: 0;

        list-style: none;
    }

    /*
     * Value then label, on one baseline. Negative inline margin so the hover
     * fill has room without moving the text off the column's left edge.
     */
    &_item {
        display: inline-flex;
        gap: var(--space-3);
        align-items: baseline;

        margin: 0 calc(-1 * var(--space-3));
        padding: var(--space-1) var(--space-3);
        border-radius: var(--radius-sm);

        text-decoration: none;

        transition: background 140ms cubic-bezier(0.16, 1, 0.3, 1);

        @include hover() {
            &:hover {
                background: $surface2;

                .queues_label { color: $content3; }
            }
        }

        &:focus-visible {
            outline: 2px solid $primary600;
            outline-offset: 1px;
        }

        &--skeleton { cursor: default; }

        /*
         * THE ONE PLACE ON THIS PAGE THAT SPENDS THE ACCENT, on exactly what
         * DESIGN.md says it means: something the system is offering the
         * reader to act on. A non-empty queue is that; a zero is not, and
         * stays colourless. `$primary600`, the measured 4.51:1 text step.
         */
        &--waiting .queues_value {
            color: $primary600;
        }
    }

    /*
     * `--font-size-lg` against the counts row's `--font-size-md`: THE promoted
     * number on the page, one step up, not the 24px page-title register the
     * tiles used to spend on three zeros. Tabular, because it changes in place.
     */
    &_value {
        font-size: var(--font-size-lg);
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

    /* Sentence case, not the label register: inline after a numeral it is a
       phrase ("3 plan proposals"), and uppercase would shout it. */
    &_label {
        font-size: var(--font-size-sm);
        color: $content6;
        transition: color 140ms cubic-bezier(0.16, 1, 0.3, 1);
    }

    // A still block at the value's own height, not a shimmer: reserving the
    // space is the whole job, and it costs no frames on the first paint.
    &_skeleton {
        display: inline-block;
        border-radius: var(--radius-sm);
        background: $surface3;

        &--value {
            width: 2ch;
            height: var(--font-size-lg);
        }

        &--label {
            width: 9ch;
            height: var(--font-size-sm);
        }
    }
}
</style>
