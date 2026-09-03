<template>
    <!--
        The institution's shape, stated rather than implied. Six true counts,
        each a link to the entity it counts.

        DELIBERATELY THE QUIETER OF THE TWO STRIPS, and that is the one thing
        to preserve here. These tiles and the review queues above them used to
        be typographically identical: the same 24px value, the same weight, the
        same padding. So a page whose whole job is "is anything waiting for me"
        opened as eight facts of equal weight, six of which nobody can act on
        (a room count is never good or bad) and two of which are requests. The
        hierarchy was carried only by a heading and by an accent that is
        correctly ABSENT when a queue is empty, which is exactly when the eye
        needs to be told which strip is which.

        So: 17px values against the queues' 24px, tighter padding, same
        11px uppercase label. Not smaller because these facts are unimportant,
        but because they are AMBIENT, and a reader who wants them is orienting
        rather than deciding. Their position is unchanged, above the
        destinations rather than below them: "is this tenant populated at all"
        is only useful BEFORE you pick where to go.

        A HEADING, matching the queues', so the two families are both named
        rather than one labelled and one bare. It also gives the strip an
        accessible name it never had: a screen reader met six links and no
        statement of what they were counting.

        NO CARD BOXES. DESIGN.md's cockpit density band is explicit: "tight
        paddings, no card boxes, 1px lines separate data", and the separators
        here are the grid's own 1px `gap` showing the container's `$surface4`
        through. That gives exact hairlines in every wrap configuration without
        a single border declaration, and the tiles sit on the page ground so
        nothing reads as a raised box.
    -->
    <section
        v-if="pending || counts.length"
        class="counts"
    >
        <h2 class="counts_heading">{{ t('dashboard.counts.heading') }}</h2>

        <!--
            THE QUIETER ROW, one line: "2 people · 0 groups · 0 rooms …", each
            a link to the entity it counts. Six tiles with uppercase captions
            used to spend ~70px on facts that are AMBIENT: a room count is
            never good or bad, and a reader who wants it is orienting, not
            deciding. Same row grammar as the queues above, one type step
            smaller, so the two differ by size and by order and nothing else.
        -->
        <ul
            v-if="pending"
            class="counts_list"
            aria-hidden="true"
        >
            <li
                v-for="index in skeletonCount"
                :key="index"
                class="counts_item counts_item--skeleton"
            >
                <span class="counts_skeleton counts_skeleton--value"/>
                <span class="counts_skeleton counts_skeleton--label"/>
            </li>
        </ul>

        <ul
            v-else
            class="counts_list"
        >
            <li
                v-for="count in counts"
                :key="count.key"
            >
                <NuxtLink
                    class="counts_item"
                    :to="count.to"
                >
                    <!--
                        A failed count renders as the word, never as 0 and
                        never as a dash: "no rows" and "could not ask" are
                        different facts. Zero is a real answer.
                    -->
                    <span
                        v-if="count.total === null"
                        class="counts_value counts_value--unavailable"
                    >{{ t('dashboard.counts.unavailable') }}</span>
                    <span
                        v-else
                        class="counts_value"
                    >{{ count.total.toLocaleString() }}</span>

                    <span class="counts_label">{{ count.label }}</span>
                </NuxtLink>
            </li>
        </ul>
    </section>
</template>

<script setup lang="ts">
import type { EntityCount } from '~/utils/institutionCounts';
import { COUNTED_KEYS } from '~/utils/institutionCounts';
import { useT } from '~/composables/i18n';

/**
 * Presentation only. The fetch lives in `useInstitutionCounts()` and the page
 * holds the await, so this component has no boundary of its own to own and
 * renders whatever it is handed, including the failed-tile case.
 */
const props = defineProps<{
    counts: readonly EntityCount[];
    pending?: boolean;
}>();

/*
 * ONLY the heading and "Unavailable" are this component's own copy:
 * `count.label` arrives already resolved from `countedEntities(held, t)`, so a
 * tile's name is the manage registry's one translation of it rather than a
 * second one here.
 */
const { t } = useT();

/*
 * The module's own ceiling, READ FROM IT rather than written here as a number:
 * a seventh `COUNTED_KEYS` entry would otherwise leave the skeleton one tile
 * short forever, and nothing would report it. On a first load there is no
 * resolved list to measure, so the skeleton cannot derive its own length from
 * `counts`; once a length is known it is used, which keeps a client-side
 * refresh from changing the strip's width mid-flight.
 */
const skeletonCount = computed(() => (props.counts.length > 0 ? props.counts.length : COUNTED_KEYS.length));
</script>

<style scoped lang="scss">
/* Same facts-row grammar as `ReviewQueues`; the heading column width is
   duplicated by hand so the two rows align. */
.counts {
    display: grid;
    grid-template-columns: minmax(8rem, 11rem) minmax(0, 1fr);
    gap: var(--space-3) var(--space-6);
    align-items: baseline;

    @include mobile() {
        grid-template-columns: minmax(0, 1fr);
    }

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

                .counts_label { color: $content3; }
            }
        }

        &:focus-visible {
            outline: 2px solid $primary600;
            outline-offset: 1px;
        }

        &--skeleton { cursor: default; }
    }

    /* One step under the queues' `--font-size-lg`: the ordinary value
       register. Tabular, because these change in place on refresh. */
    &_value {
        font-size: var(--font-size-md);
        font-weight: 650;
        font-variant-numeric: tabular-nums;
        line-height: var(--leading-tight);
        color: $content2;

        &--unavailable {
            font-size: var(--font-size-sm);
            font-weight: 400;
            color: $content7;
        }
    }

    &_label {
        font-size: var(--font-size-sm);
        color: $content7;
        transition: color 140ms cubic-bezier(0.16, 1, 0.3, 1);
    }

    &_skeleton {
        display: inline-block;
        border-radius: var(--radius-sm);
        background: $surface3;

        &--value {
            width: 2ch;
            height: var(--font-size-md);
        }

        &--label {
            width: 7ch;
            height: var(--font-size-sm);
        }
    }
}
</style>
