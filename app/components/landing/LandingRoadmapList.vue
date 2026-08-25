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
 * Both halves of the roadmap — what works and what does not — through one
 * component, because they are one list with two states and reading them in the
 * same visual language is the whole point.
 *
 * NO GREEN, AND THAT IS MEASURED. The done marker was `$success600`, which is
 * 2.42:1 against the page ground; the whole success ramp is too light for a
 * light ground, so there is no step of it that passes 3:1 for a non-text
 * indicator. It is `$content2` now — a filled check in ink at 14.6:1 — against
 * an outlined circle in `$content7` at 7:1. Shape and fill carry the state,
 * both readable, neither faint. That also keeps the page honest with
 * `DESIGN.md`, where green is not a state colour at all.
 *
 * Titles are at the section-title register rather than the app's body size.
 * Seventeen rows are the spine of this page's argument and were set two steps
 * below the copy explaining them.
 */
defineProps<{
    items: LandingRoadmapItem[];
}>();

const DONE_ICON = 'material-symbols:check-circle';
const NEXT_ICON = 'material-symbols:radio-button-unchecked';
</script>

<style scoped lang="scss">
.roadmap {
    margin: 0;
    padding: 0;
    list-style: none;

    &_item {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: $space5;
        align-items: start;

        padding: $space6 0;
        border-top: 1px solid $surface5;
    }

    &_marker {
        width: $space7;
        height: $space7;
    }

    &_item--done &_marker {
        color: $content2;
    }

    &_item--next &_marker {
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
