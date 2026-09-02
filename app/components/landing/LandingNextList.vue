<template>
    <ul class="next">
        <li
            v-for="item in items"
            :key="item.id"
            class="next_item"
        >
            <Icon
                class="next_marker"
                :name="NEXT_ICON"
                aria-hidden="true"
            />
            <div class="next_text">
                <h3 class="next_title">
                    <span class="sr-only">{{ t('landing.roadmap.nextPrefix') }}</span>
                    {{ item.title }}
                </h3>
                <p class="next_note">{{ item.note }}</p>
            </div>
        </li>
    </ul>
</template>

<script setup lang="ts">
import type { LandingRoadmapItem } from '~/utils/landingContent';
import { useT } from '~/composables/i18n';

/**
 * What is not built, in the one shape on the page that is deliberately quieter
 * than the section above it.
 *
 * IT USED TO SHARE A COMPONENT WITH THE BUILT LIST, on the argument that the
 * two halves are one list with two states and should read in one visual
 * language. That argument was right about the states and wrong about the
 * volume: fourteen shipped capabilities and six unfinished ones were drawn at
 * identical weight, so a page whose entire pitch is "here is exactly what
 * works" gave equal billing to what does not. The states still read as one
 * idea, because both lists use the same marker family and the same screen
 * reader prefix; the difference is that this one is set in a single column with
 * a marker rail and no rules, and the built section is a grouped grid.
 *
 * SINGLE COLUMN IS THE POINT, not a fallback. Six items is short enough to read
 * straight down, and putting them in a second column beside the built section's
 * grid would have made the two sections the same shape again, which is the
 * thing this rebuild was for. The section carries `layout="narrow"` for the
 * other half of that: one column inside the page's full 1040px measure leaves
 * half the width empty down the right, which reads as a layout that did not
 * finish rather than as a choice. Inset into a 680px column the margins are
 * even, and the inset says on its own that this section is subordinate to the
 * one above it.
 *
 * The outlined marker is `content7` at 7:1 against the page ground, against the
 * built list's filled marker in `content2` at 14.6:1. Shape and fill carry the
 * state, both pass as non-text indicators, and neither is a colour: there is no
 * green on this page, because no step of the success ramp reaches 3:1 on a
 * light ground.
 */
defineProps<{
    items: LandingRoadmapItem[];
}>();

const { t } = useT();

const NEXT_ICON = 'ph:circle-dashed';
</script>

<style scoped lang="scss">
.next {
    display: flex;
    flex-direction: column;
    gap: $space8;

    margin: 0;
    padding: 0;

    list-style: none;

    &_item {
        display: grid;

        // The marker rail. A fixed gutter rather than `auto`, so every title
        // starts on the same vertical line whatever the icon metrics do.
        grid-template-columns: $space8 minmax(0, 1fr);
        align-items: start;

        @include landingReveal(12px);

        @include mobileOnly {
            grid-template-columns: $space7 minmax(0, 1fr);
        }
    }

    &_marker {
        width: $space6;
        height: $space6;
        margin-top: 2px;
        color: $content7;
    }

    &_title {
        margin: 0 0 $space3;

        font-size: $fontSizeLg;
        font-weight: 700;
        line-height: 1.35;
        color: $content2;
        text-wrap: balance;

        @include mobileOnly {
            font-size: $fontSizeMd;
        }
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
