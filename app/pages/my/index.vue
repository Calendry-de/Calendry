<template>
    <CommonPage :title="t('my.index.pageTitle')">
        <p class="intro">{{ t('my.index.intro') }}</p>

        <!--
            A NAMED landmark. The page carried two `<nav>` elements: the
            header's `aria-label="Main"` and this one with no accessible name at
            all, so navigating by landmark offered "navigation" twice, one of
            them anonymous.
        -->
        <nav
            class="groups"
            :aria-label="t('my.index.sectionsLabel')"
        >
            <!--
                GROUPED, through the same `groupNavEntries()` the sidebar and
                the dashboard use, so the headings a reader sees here cannot
                disagree with the ones in the nav beside them. The hub was a
                flat wall of cards in which "API tokens" and "Export my data"
                had no home at all: both were panels stacked under the locale
                form on `/my/account`, whose own card reads "Your own display
                locale".
            -->
            <section
                v-for="group in groups"
                :key="group.id"
                class="groups_group"
            >
                <!--
                    `h2` for the group and `h3` for each card, so heading
                    navigation reflects the actual nesting. The cards were
                    `h2` when the page was flat.
                -->
                <h2 class="groups_heading">{{ group.label }}</h2>

                <div class="cards">
                    <NuxtLink
                        v-for="entry in group.entries"
                        :key="entry.id"
                        class="cards_card"
                        :to="entry.to!"
                    >
                        <Icon
                            class="cards_icon"
                            :name="entry.icon"
                            aria-hidden="true"
                        />
                        <h3 class="cards_label">{{ entry.label }}</h3>
                        <span class="cards_hint">{{ entry.description }}</span>
                    </NuxtLink>
                </div>
            </section>
        </nav>
    </CommonPage>
</template>

<script setup lang="ts">
import { useT } from '~/composables/i18n';
import { useNavEntries } from '~/composables/navigation';
import { groupNavEntries } from '~/utils/navGroups';

definePageMeta({ middleware: 'my' });

const { t } = useT();

// A getter, so the tab title follows a language change rather than freezing at
// whatever was active when this page first mounted.
useHead(() => ({ title: t('my.index.pageTitle') }));

/*
 * Projected from the nav registry rather than listed again, for the reason the
 * manage index does it: one array rendered several ways cannot drift, and the
 * permission filter is already applied there.
 */
const entries = computed(() => useNavEntries().value.filter((entry) => entry.section === 'my'));

/*
 * `groupNavEntries` drops any destination no `NAV_GROUPS` entry claims, which
 * is deliberate and is why `tests/nav-groups.test.ts` exists: a `/my` page
 * added without a group would vanish from this hub while staying reachable in
 * the header and in Ctrl+K, and nothing would say so. That test covers this
 * page now too, since both read the same registry.
 */
const groups = computed(() => groupNavEntries(entries.value, t));
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
.groups {
    display: flex;
    flex-direction: column;
    gap: var(--space-xl);

    &_heading {
        margin: 0 0 var(--space-s);

        font-size: var(--font-size-label);
        font-weight: 600;
        color: rgb(var(--textSoft));
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }
}

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
         * `$surface1` on a `$surface1` page ground (1.00:1), so the card only
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
         * NOT the accent. DESIGN.md spends `$primary` on one idea, "where a
         * session may land", and states it is never decorative; a hub icon is
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
