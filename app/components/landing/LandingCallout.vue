<template>
    <aside class="callout">
        <p class="callout_text">{{ text }}</p>
        <common-button
            type="primary"
            :href="href"
        >{{ action }}</common-button>
    </aside>
</template>

<script setup lang="ts">
/**
 * One call to action in the middle of the page.
 *
 * There were two conversion affordances in 1,500 words — the hero pair and the
 * form itself — so a reader persuaded by the list of what already works had
 * roughly 800 words and two more sections to scroll before they could act on
 * it. This sits directly after that list, where conviction is highest.
 *
 * A single line and a button, not a panel: a boxed mid-page CTA would read as
 * the fourth card device on a page that just had its card devices removed.
 */
defineProps<{
    text: string;
    action: string;
    href: string;
}>();
</script>

<style scoped lang="scss">
.callout {
    display: flex;
    flex-wrap: wrap;
    gap: $space5 $space7;
    align-items: center;
    justify-content: space-between;

    margin-top: $space9;
    padding-top: $space6;
    border-top: 1px solid $surface5;

    &_text {
        max-width: 52ch;
        margin: 0;

        font-size: $fontSizeLg;
        font-weight: 600;
        line-height: 1.45;
        color: $content4;
        text-wrap: balance;

        @include mobileOnly {
            font-size: $fontSizeMd;
        }
    }
}
</style>
