<template>
    <!--
        The one container this plane uses: `surface0` recessed on the
        `surface1` ground with a 1px `surface4` edge and the panel radius. No
        shadow, per the Floats-Or-Flat rule. The heading row holds a title,
        an optional lead, and an optional right-hand slot for a count or a
        control.
    -->
    <section class="panel">
        <header class="panel_head">
            <div class="panel_titles">
                <h2 class="panel_title">{{ title }}</h2>
                <p
                    v-if="lead"
                    class="panel_lead"
                >{{ lead }}</p>
                <slot name="lead"/>
            </div>
            <div
                v-if="$slots.aside"
                class="panel_aside"
            >
                <slot name="aside"/>
            </div>
        </header>

        <slot/>
    </section>
</template>

<script setup lang="ts">
defineProps<{ title: string; lead?: string }>();
defineSlots<{ default: () => unknown; aside?: () => unknown; lead?: () => unknown }>();
</script>

<style scoped lang="scss">
.panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);

    padding: var(--space-6);
    border: 1px solid $surface4;
    border-radius: var(--radius-xl);

    background: $surface0;

    @include mobile() { padding: var(--space-5); }

    &_head {
        display: flex;
        gap: var(--space-5);
        align-items: flex-start;
        justify-content: space-between;
    }

    &_titles {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        min-width: 0;
    }

    &_title {
        margin: 0;

        font-size: var(--font-size-lg);
        font-weight: 650;
        line-height: var(--leading-tight);
        color: $content2;
    }

    &_lead {
        margin: 0;
        font-size: var(--font-size-sm);
        line-height: var(--leading-prose);
        color: $content7;
    }

    &_aside {
        flex: none;
    }
}
</style>
