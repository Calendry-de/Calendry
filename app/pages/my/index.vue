<template>
    <common-page title="My settings">
        <p class="intro">Things you set for yourself. Nobody else's data is reachable from here.</p>

        <nav class="cards">
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
                <span class="cards_label">{{ entry.label }}</span>
                <span class="cards_hint">{{ entry.description }}</span>
            </NuxtLink>
        </nav>
    </common-page>
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
    margin: 0;
    font-size: var(--font-size-sm);
    color: $content7;
}

.cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: var(--space-5);

    &_card {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);

        padding: var(--space-6);
        border-radius: var(--radius-xl);

        text-decoration: none;

        background: $surface1;

        &:hover {
            background: $surface2;
        }
    }

    &_icon {
        width: 22px;
        height: 22px;
        color: $primary500;
    }

    &_label {
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
