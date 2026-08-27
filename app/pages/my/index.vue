<template>
    <CommonPage title="My settings">
        <p class="intro">Things you set for yourself. Nobody else's data is reachable from here.</p>

        <!--
            A NAMED landmark. The page carried two `<nav>` elements — the
            header's `aria-label="Main"` and this one with no accessible name at
            all — so navigating by landmark offered "navigation" twice, one of
            them anonymous.
        -->
        <nav
            class="cards"
            aria-label="My settings sections"
        >
            <NuxtLink
                v-for="entry in entries"
                :key="entry.id"
                class="cards_card"
                :to="entry.to!"
            >
                <Icon
                    class="cards_icon"
                    :name="entry.icon"
                    aria-hidden="true"
                />
                <!--
                    An `h2`, not a `span`: the page rendered an `h1` and nothing
                    else, so browsing by heading — how a screen-reader user skims
                    — found no structure below the title.
                -->
                <h2 class="cards_label">{{ entry.label }}</h2>
                <span class="cards_hint">{{ entry.description }}</span>
            </NuxtLink>
        </nav>
    </CommonPage>
</template>

<script setup lang="ts">
import { useNavEntries } from '~/composables/navigation';

definePageMeta({ middleware: 'my' });

useHead({ title: 'My settings' });

/*
 * Projected from the nav registry rather than listed again, for the reason the
 * manage index does it: one array rendered several ways cannot drift, and the
 * permission filter is already applied there.
 */
const entries = computed(() => useNavEntries().value.filter((entry) => entry.section === 'my'));
</script>

<style scoped lang="scss">
.intro {
    max-width: 68ch;
    margin: 0;
    font-size: var(--font-size-sm);
    color: $content7;
}

/*
 * `auto-fill` only ever produced one usable row of tracks once the page column
 * had a width to fill: under `CommonPage`'s old `align-items: center` this grid
 * shrink-wrapped to 504.7px inside a 1376px box, which is what left a ragged
 * orphan card on a third row. `auto-fit` collapses empty tracks instead, so a
 * two-entry section does not leave a phantom column.
 */
.cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: var(--space-5);

    &_card {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);

        padding: var(--space-6);

        /*
         * A visible EDGE, because these are click targets and their fill was
         * `$surface1` on a `$surface1` page ground — 1.00:1, so the card only
         * became visible on hover, at 1.09:1. The palette has no raised surface
         * to give them, so the boundary does the work; 3.14:1 clears 1.4.11.
         */
        border: 1px solid varToRgba('content7', 0.65);
        border-radius: var(--radius-xl);

        text-decoration: none;

        &:hover {
            background: $surface2;
        }

        &:focus-visible {
            outline: 2px solid $primary600;
            outline-offset: var(--space-1);
        }
    }

    &_icon {
        width: 22px;

        /*
         * NOT the accent. DESIGN.md spends `$primary` on one idea — "where a
         * session may land" — and states it is never decorative; a hub icon is
         * decoration. It also measured 2.94:1 on this ground, failing 1.4.11 as
         * a 22px glyph. `$content7` is 7.28:1 and spends nothing.
         */
        height: 22px;
        color: $content7;
    }

    &_label {
        margin: 0;
        font-size: var(--font-size-md);
        font-weight: 680;
        color: $content2;
    }

    &_hint {
        font-size: var(--font-size-sm);
        line-height: 1.5;
        color: $content7;
    }
}
</style>
