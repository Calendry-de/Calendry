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

        <div
            v-if="pending"
            class="counts_grid"
            aria-hidden="true"
        >
            <!--
                Skeleton in the FINAL SHAPE, not a spinner: same tile count,
                same two-line stack, so the strip does not resize when the
                numbers land. `aria-hidden` because a screen reader gains
                nothing from six placeholder tiles.
            -->
            <div
                v-for="index in skeletonCount"
                :key="index"
                class="counts_tile counts_tile--skeleton"
            >
                <span class="counts_skeleton counts_skeleton--value"/>
                <span class="counts_skeleton counts_skeleton--label"/>
            </div>
        </div>

        <div
            v-else
            class="counts_grid"
        >
            <NuxtLink
                v-for="count in counts"
                :key="count.key"
                class="counts_tile"
                :to="count.to"
            >
                <!--
                    A failed count renders as the word, never as 0 and never as a
                    dash: "no rows" and "could not ask" are different facts, and
                    drawing them the same way is what makes a broken tile
                    invisible. Zero is a real answer and gets the real numeral.
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
        </div>
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
.counts {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);

    /*
     * The 11px uppercase label register DESIGN.md reserves for group headings,
     * the same one the review queues' heading and the sidebar's own headings
     * use. An `h2` because this is a real section of the page and belongs in
     * the document outline.
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
     * GAP AS HAIRLINE: the 1px gap reveals the container's own `$surface4`
     * between tiles, so separators land exactly on the grid in any wrap
     * configuration. `overflow: hidden` keeps the outer edge from showing a
     * stray 1px of it on the container's own boundary.
     */
    &_grid {
        overflow: hidden;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
        gap: 1px;

        background: $surface4;

        @include mobile() {
            grid-template-columns: repeat(2, 1fr);
        }
    }

    &_tile {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);

        // Tighter than the queues' `--space-5 --space-6`, which is half of what
        // makes this the quieter strip; the other half is the value size below.
        padding: var(--space-4) var(--space-5);

        text-decoration: none;

        // The page ground, so a tile is not a box. Only the gap reads.
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
    }

    &_value {
        /*
         * `--font-size-lg` (17px), against the review queues' `--font-size-xl`
         * (24px). DESIGN.md's in-app scale tops out at 17px for section titles
         * and reserves 24px for page titles, so this is the ordinary value
         * register and the queues are the page's one promoted number. Growing
         * the queues instead would have needed 32px, the display step, which
         * on a cockpit surface reads as a marketing page rather than a hero.
         *
         * TABULAR NUMERALS, per DESIGN.md's own named rule: these are counts
         * that change in place on refresh, and proportional digits make the
         * strip shiver as they do.
         */
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

    &_label {
        font-size: var(--font-size-xs);
        font-weight: 650;
        color: $content7;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    /*
     * A shimmer would need an infinite loop on the home page's first paint.
     * A still block at the value's own height reserves the space, which is the
     * whole job, and costs no frames.
     */
    &_skeleton {
        border-radius: var(--radius-sm);
        background: $surface3;

        &--value {
            width: 2.5ch;
            height: var(--font-size-lg);
        }

        &--label {
            width: 7ch;
            height: var(--font-size-xs);
        }
    }
}
</style>
