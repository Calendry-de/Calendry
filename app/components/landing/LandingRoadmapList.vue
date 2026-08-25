<template>
    <ul class="roadmap">
        <li
            v-for="item in items"
            :key="item.id"
            class="roadmap_item"
            :class="`roadmap_item--${ item.state }`"
        >
            <Icon
                class="roadmap_marker"
                :name="item.state === 'done' ? DONE_ICON : NEXT_ICON"
                aria-hidden="true"
            />
            <div class="roadmap_text">
                <h3 class="roadmap_title">
                    <span class="sr-only">{{ item.state === 'done' ? 'Working: ' : 'Not built yet: ' }}</span>
                    {{ item.title }}
                </h3>
                <p class="roadmap_note">{{ item.note }}</p>
            </div>
        </li>
    </ul>
</template>

<script setup lang="ts">
import type { LandingRoadmapItem } from '~/utils/landingContent';

/**
 * Both halves of the honest roadmap — what works and what does not — through one
 * component, because they are one list with two states and reading them in the
 * same visual language is the whole point. Two components would let "built" and
 * "next" drift into looking like different kinds of claim.
 *
 * State is never carried by colour alone: a filled check versus an open circle,
 * plus screen-reader text on every row. Same rule the schedule's violation
 * markers follow (DESIGN.md, "Violations never signal by hue alone").
 */
defineProps<{
    items: LandingRoadmapItem[];
}>();

const DONE_ICON = 'material-symbols:check-circle';
const NEXT_ICON = 'material-symbols:radio-button-unchecked';
</script>

<style scoped lang="scss">
.roadmap {
    display: grid;
    gap: $space6;

    margin: 0;
    padding: 0;

    list-style: none;

    &_item {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: $space5;
        align-items: start;
    }

    &_marker {
        width: $space7;
        height: $space7;
    }

    &_item--done &_marker {
        color: $success600;
    }

    &_item--next &_marker {
        color: $surface7;
    }

    &_title {
        margin: 0 0 $space2;
        font-size: $fontSizeMd;
        font-weight: 700;
        color: $content2;
    }

    &_note {
        max-width: 68ch;
        margin: 0;

        font-size: $fontSizeSm;
        line-height: 1.7;
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
