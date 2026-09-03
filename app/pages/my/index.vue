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
                disagree with the ones in the nav beside them.

                A SETTINGS LIST, NOT A CARD GRID. Nine outlined cards in three
                columns, each carrying an icon, a title and a wrapped blurb,
                read as a wall the eye had to search; and their borders were
                the darkest thing on the page. Rows separated by hairlines are
                the shape every settings surface a reader already knows uses:
                one destination per line, scanned top to bottom, the blurb
                beside the name where it is read once and then skipped.
            -->
            <section
                v-for="group in groups"
                :key="group.id"
                class="groups_group"
            >
                <!--
                    `h2` for the group and `h3` for each row, so heading
                    navigation reflects the actual nesting.
                -->
                <h2 class="groups_heading">{{ group.label }}</h2>

                <ul class="rows">
                    <li
                        v-for="entry in group.entries"
                        :key="entry.id"
                    >
                        <NuxtLink
                            class="rows_row"
                            :to="entry.to!"
                        >
                            <Icon
                                class="rows_icon"
                                :name="entry.icon"
                                aria-hidden="true"
                            />
                            <span class="rows_text">
                                <h3 class="rows_label">{{ entry.label }}</h3>
                                <span class="rows_hint">{{ entry.description }}</span>
                            </span>
                            <Icon
                                class="rows_chevron"
                                name="material-symbols:chevron-right"
                                aria-hidden="true"
                            />
                        </NuxtLink>
                    </li>
                </ul>
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
/*
 * MINUS THIS PAGE. The `my` entry's target IS `/my`, so the hub used to open
 * with a card pointing at itself ("Meine Einstellungen: Ihre eigene
 * Verfügbarkeit…"), the same self-link the dashboard drops as noise.
 */
const route = useRoute();
const navEntries = useNavEntries();
const entries = computed(() => navEntries.value.filter(
    (entry) => entry.section === 'my' && entry.to !== route.path,
));

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

    font-size: var(--font-size-md);
    line-height: var(--leading-prose);
    color: $content6;
}

/*
 * `--space-8`, the in-app ceiling, between groups; `--space-3` from a heading
 * to its list. (The previous rules named `--space-xl`, `--space-s`,
 * `--font-size-label` and `--textSoft`, none of which exist in
 * `tokens-root.scss`, so the headings rendered at body size and the groups
 * had no gap at all.)
 */
.groups {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);

    /* A settings list is read, not filled: cap the measure so a row's hint
       stays one line at desktop and the chevron sits near the text. */
    max-width: 760px;

    /* The 11px uppercase label register the sidebar's group headings use. */
    &_heading {
        margin: 0 0 var(--space-3);
        padding: 0 var(--space-5);

        font-size: var(--font-size-xs);
        font-weight: 650;
        color: $content7;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }
}

.rows {
    display: flex;
    flex-direction: column;

    margin: 0;
    padding: 0;
    border-top: 1px solid $surface3;

    list-style: none;

    /* Hairlines between rows: the surface-ramp edge DESIGN.md gives an
       occupied cell, never a box per row. */
    > li {
        border-bottom: 1px solid $surface3;
    }

    &_row {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        gap: var(--space-5);
        align-items: center;

        padding: var(--space-4) var(--space-5);
        border-radius: var(--radius-md);

        text-decoration: none;

        transition: background 140ms cubic-bezier(0.16, 1, 0.3, 1);

        @include hover() {
            &:hover {
                background: $surface2;

                .rows_chevron { color: $content5; }
            }
        }

        &:focus-visible {
            outline: 2px solid $primary600;
            outline-offset: -2px;
        }

        // Thumb-reached below 700px.
        @include mobileOnly() { min-height: 56px; }
    }

    /*
     * NOT the accent. DESIGN.md spends `$primary` on one idea, "where a
     * session may land", and states it is never decorative; a hub icon is
     * decoration. `$content7` also clears 1.4.11 where teal (2.94:1) did not.
     */
    &_icon {
        width: 20px;
        height: 20px;
        color: $content7;
    }

    &_text {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
        min-width: 0;
    }

    &_label {
        margin: 0;
        font-size: var(--font-size-md);
        font-weight: 600;
        color: $content2;
    }

    &_hint {
        font-size: var(--font-size-sm);
        line-height: var(--leading-prose);
        color: $content7;
    }

    /* The affordance: this row goes somewhere. Quiet until hovered. */
    &_chevron {
        width: 18px;
        height: 18px;
        color: $surface7;
        transition: color 140ms cubic-bezier(0.16, 1, 0.3, 1);
    }
}
</style>
