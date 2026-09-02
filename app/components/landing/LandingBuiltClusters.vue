<template>
    <div class="built">
        <section
            v-for="group in groups"
            :key="group.cluster"
            class="built_group"
        >
            <h3 class="built_clusterTitle">{{ group.title }}</h3>

            <ul class="built_items">
                <li
                    v-for="item in group.items"
                    :key="item.id"
                    class="built_item"
                >
                    <h4 class="built_title">
                        <Icon
                            class="built_marker"
                            :name="DONE_ICON"
                            aria-hidden="true"
                        />
                        <span class="sr-only">{{ t('landing.roadmap.builtPrefix') }}</span>
                        {{ item.title }}
                    </h4>
                    <p class="built_note">{{ item.note }}</p>
                </li>
            </ul>
        </section>
    </div>
</template>

<script setup lang="ts">
import type { BuiltCluster, LandingRoadmapItem } from '~/utils/landingContent';
import { BUILT_CLUSTERS, builtClusterTitle } from '~/utils/landingContent';
import { useT } from '~/composables/i18n';

/**
 * The built list, grouped into the four questions it answers.
 *
 * WHY THIS IS NOT ONE LIST ANY MORE. Fourteen rows, each with a hairline above
 * it, was the longest single shape on the page, and three neighbouring sections
 * were drawn the same way. Two separate problems: a reader scanning for whether
 * the product does the one thing they came to check had fourteen equal rows and
 * no landmarks, and the middle of the page ran four sections deep in one
 * rhythm. Grouping fixes both at once. Four headings are four places to stop,
 * and the section now carries four rules where it carried fourteen.
 *
 * ORDER IS PRESERVED, NOT REPLACED. `BUILT_CLUSTERS` sets the order of the
 * groups and the source array sets the order inside each one, so the editorial
 * sequence the flat list argued for (what a timetabling officer touches daily
 * first, what an evaluator asks about last) still reads top to bottom. Grouping
 * added headings; it moved no claim.
 *
 * ROWS WITH NO CLUSTER ARE DROPPED ON PURPOSE, and that is the loud failure
 * rather than the quiet one. `cluster` is optional on the interface because
 * `NEXT` has none, so a new `BUILT` row that forgets it would otherwise render
 * in a silent fifth group with no heading. `tests/landing-page.test.ts` asserts
 * every `BUILT` title reaches the page, so a forgotten cluster fails that test
 * by name instead of shipping an unlabelled row.
 */
const props = defineProps<{
    items: LandingRoadmapItem[];
}>();

const { t } = useT();

const DONE_ICON = 'ph:check-circle-fill';

// `cluster` is the id a row is matched on and `title` is the heading a reader
// sees. They were one string before issue #19, which is exactly the shape that
// breaks on translation: the group would stop matching its own rows.
const groups = computed(() => BUILT_CLUSTERS
    .map((cluster: BuiltCluster) => ({
        cluster,
        title: builtClusterTitle(cluster, t),
        items: props.items.filter(item => item.cluster === cluster),
    }))
    .filter(group => group.items.length > 0));
</script>

<style scoped lang="scss">
.built {
    display: flex;
    flex-direction: column;
    gap: $space10;

    @include mobileOnly {
        gap: $space9;
    }

    &_group {
        @include landingReveal(14px);
    }

    &_clusterTitle {
        margin: 0 0 $space7;
        padding-top: $space5;

        // The section's only rules: one per group, where the flat list drew one
        // per row.
        border-top: 1px solid $surface5;

        font-size: $fontSizeLg;
        font-weight: 700;
        line-height: 1.35;
        color: $content2;
    }

    &_items {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: $space8 $space9;

        margin: 0;
        padding: 0;

        list-style: none;

        // One column only where a column genuinely cannot hold a sentence. The
        // two-column measure is ~62ch at the page's widest, which is inside the
        // prose range; one column at the same width would be ~130.
        @include mobileOnly {
            grid-template-columns: minmax(0, 1fr);
            gap: $space7;
        }
    }

    &_title {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: $space4;
        align-items: start;

        margin: 0 0 $space3;

        // A step below the cluster heading above it. The flat list set these at
        // 17px because they were the only structure the section had; the cluster
        // headings carry that job now, so the rows can sit where body-weight
        // structure belongs without losing the hierarchy.
        font-size: $fontSizeMd;
        font-weight: 700;
        line-height: 1.5;
        color: $content2;
    }

    /*
     * NO GREEN, AND THAT IS MEASURED. The done marker was `success600` at 2.42:1
     * against the page ground, and no step of that ramp passes 3:1 for a
     * non-text indicator on a light ground. Ink at 14.6:1 instead. The state is
     * also never carried by the icon alone: the `sr-only` prefix says "Working"
     * in words, and the cluster this row sits in is inside a section titled
     * "What works today".
     */
    &_marker {
        width: $space6;
        height: $space6;
        margin-top: 1px;
        color: $content2;
    }

    &_note {
        max-width: 68ch;
        margin: 0;

        font-size: $fontSizeMd;
        line-height: 1.75;
        color: $content6;
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
