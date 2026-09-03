<template>
    <div class="shell">
        <!--
            NOT `CommonAppShell`. That shell's sidebar is `useAppSections()`'s
            permission-filtered TENANT navigation, and a staff session is never
            in a tenant, so it would render an empty rail around an internal
            tool. This is the staff plane's own, smaller frame: a brand line, a
            tab strip over the three cross-tenant surfaces, and the page.
        -->
        <header class="shell_header">
            <div class="shell_brand">
                <span class="shell_mark" aria-hidden="true">C</span>
                <div class="shell_titles">
                    <p class="shell_kicker">{{ t('staff.shell.kicker') }}</p>
                    <h1 class="shell_title">{{ t('staff.brand.heading') }}</h1>
                </div>
            </div>

            <div class="shell_actions">
                <slot name="actions"/>
            </div>
        </header>

        <!--
            Tabs are the URL (`?tab=`), so a reload and a shared link land on
            the same surface, and the browser's own history works. The active
            tab's underline is the ONE place Signal Teal appears on this page:
            an active toggle, which is what the accent is for.
        -->
        <nav
            class="shell_tabs"
            :aria-label="t('staff.shell.tabsLabel')"
        >
            <NuxtLink
                v-for="tab in tabs"
                :key="tab.id"
                class="shell_tab"
                :class="{ 'shell_tab--active': tab.id === active }"
                :aria-current="tab.id === active ? 'page' : undefined"
                :to="{ query: tab.id === tabs[0]!.id ? {} : { tab: tab.id } }"
                replace
            >
                <Icon
                    class="shell_tab-icon"
                    :name="tab.icon"
                    aria-hidden="true"
                />
                {{ tab.label }}
                <span
                    v-if="tab.count !== undefined"
                    class="shell_tab-count"
                >{{ tab.count }}</span>
            </NuxtLink>
        </nav>

        <main class="shell_main">
            <slot/>
        </main>
    </div>
</template>

<script setup lang="ts">
import { useT } from '~/composables/i18n';

export interface StaffTab {
    id: string;
    label: string;
    icon: string;
    /** A live count shown beside the label; absent means no count. */
    count?: number;
}

defineProps<{
    tabs: StaffTab[];
    active: string;
}>();

defineSlots<{ default: () => unknown; actions?: () => unknown }>();

const { t } = useT();
</script>

<style scoped lang="scss">
.shell {
    display: flex;
    flex-direction: column;

    min-height: 100vh;

    color: $content4;

    background: $surface1;

    &_header {
        display: flex;
        gap: var(--space-6);
        align-items: center;
        justify-content: space-between;

        padding: var(--space-6) var(--space-8) 0;

        @include mobile() { padding: var(--space-5) var(--space-5) 0; }
    }

    &_brand {
        display: flex;
        gap: var(--space-4);
        align-items: center;
    }

    /* The lockup's mark: the same 4px radius and ink-on-teal pairing every
       primary button uses (5.7:1 measured), so the plane reads as Calendry's
       own rather than a stranger's admin template. */
    &_mark {
        display: grid;
        place-items: center;

        width: 36px;
        height: 36px;
        border-radius: var(--radius-sm);

        font-size: var(--font-size-lg);
        font-weight: 650;
        color: $content0;

        background: $primary500;
    }

    &_titles {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
    }

    /* The label register, the one uppercase in the system. */
    &_kicker {
        margin: 0;

        font-size: var(--font-size-xs);
        font-weight: 650;
        color: $content7;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    &_title {
        margin: 0;

        font-size: var(--font-size-xl);
        font-weight: 400;
        line-height: var(--leading-tight);
        color: $content1;
    }

    &_actions {
        display: flex;
        gap: var(--space-3);
        align-items: center;
    }

    &_tabs {
        overflow-x: auto;
        display: flex;
        gap: var(--space-2);

        margin-top: var(--space-6);
        padding: 0 var(--space-8);
        border-bottom: 1px solid $surface4;

        @include mobile() { padding: 0 var(--space-5); }
    }

    &_tab {
        display: inline-flex;
        gap: var(--space-2);
        align-items: center;

        margin-bottom: -1px;
        padding: var(--space-3) var(--space-4);
        border-bottom: 2px solid transparent;

        font-size: var(--font-size-md);
        line-height: var(--leading-tight);
        color: $content6;
        text-decoration: none;
        white-space: nowrap;

        transition: color 0.15s;

        &:hover { color: $content2; }

        &:focus-visible {
            outline: 2px solid $primary600;
            outline-offset: -2px;
        }

        &--active {
            border-bottom-color: $primary500;
            color: $content1;
        }

        &-icon {
            width: 16px;
            height: 16px;
        }

        &-count {
            padding: 0 var(--space-2);
            border-radius: var(--radius-sm);

            font-size: var(--font-size-xs);
            font-variant-numeric: tabular-nums;
            color: $content6;

            background: $surface3;
        }
    }

    &_main {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: var(--space-7);

        width: 100%;
        max-width: 1280px;
        margin: 0 auto;
        padding: var(--space-7) var(--space-8) var(--space-8);

        @include mobile() { padding: var(--space-5); }
    }
}
</style>
