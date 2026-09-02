<template>
    <ul class="faq">
        <li
            v-for="item in items"
            :key="item.id"
            class="faq_row"
        >
            <details class="faq_disclosure">
                <summary class="faq_question">
                    <span class="faq_questionText">{{ item.question }}</span>

                    <Icon
                        class="faq_caret"
                        name="ph:plus"
                        aria-hidden="true"
                    />
                </summary>

                <p class="faq_answer">{{ item.answer }}</p>
            </details>
        </li>
    </ul>
</template>

<script setup lang="ts">
import type { LandingFaqEntry } from '~/utils/landingContent';

/**
 * The objection list, as native disclosures.
 *
 * `<details>` AND `<summary>`, not a JavaScript accordion. Open and close,
 * keyboard operation, the correct roles, and find-in-page all come from the
 * element: a browser can search inside a closed `<details>` and open it, which
 * a `v-if` accordion silently breaks. This page is read by people evaluating
 * software, and the first thing some of them do is Ctrl+F for "import".
 *
 * NO `name` ATTRIBUTE, so the rows do not close each other. Exclusive
 * disclosures are tidier and wrong here: two of these answers are read
 * together (what is not built, and what it costs), and closing the one a
 * reader just opened to open another is the browser deciding they were done
 * reading.
 *
 * ALL CLOSED AT FIRST PAINT. An FAQ with the first row open is a paragraph
 * pretending to be a list, and it pushes the other ten below the fold of the
 * section.
 *
 * STRUCTURED DATA COMES FROM THE SAME ARRAY as the markup, in this component
 * rather than in the page. That is the whole reason it lives here: a schema
 * block assembled in `index.vue` from a second list would be free to describe
 * questions this section does not render, and search engines would be quoting
 * a page that does not exist. One list, both consumers.
 */
const props = defineProps<{ items: LandingFaqEntry[] }>();

useHead(() => ({
    script: [{
        key: 'landing-faq-schema',
        type: 'application/ld+json',
        innerHTML: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: props.items.map((item) => ({
                '@type': 'Question',
                name: item.question,
                acceptedAnswer: { '@type': 'Answer', text: item.answer },
            })),
        }),
    }],
}));
</script>

<style scoped lang="scss">
.faq {
    margin: 0;
    padding: 0;
    list-style: none;

    &_row {
        @include landingReveal;

        // The rows are separated by their own borders rather than by a rule on
        // one edge: each disclosure is a bounded box, so the list needs no
        // dividers, and a single-sided border is forbidden anyway.
        & + & {
            margin-top: $space4;
        }
    }

    &_disclosure {
        border: 1px solid $surface4;
        border-radius: $radius2Xl;
        background: $surface1;
    }

    &_question {
        cursor: pointer;

        display: flex;
        gap: $space5;
        align-items: baseline;
        justify-content: space-between;

        padding: $space6;

        font-size: $fontSizeMd;
        font-weight: 600;
        line-height: $lineHeightMd;
        color: $content2;

        // The default triangle is replaced by the icon on the right, so the
        // marker is removed in both the standard and the WebKit spelling.
        list-style: none;

        transition: color 320ms cubic-bezier(0.32, 0.72, 0, 1);

        &::-webkit-details-marker {
            display: none;
        }

        @include hover {
            &:hover {
                color: $content0;
            }
        }

        // The press state. `translateY(1px)` rather than a scale, because a
        // full-width row scaling down detaches visibly from its own border.
        &:active {
            transform: translateY(1px);
        }

        &:focus-visible {
            outline: 2px solid $primary600;
            outline-offset: $space1;
        }
    }

    &_questionText {
        text-wrap: pretty;
    }

    &_caret {
        flex: 0 0 auto;

        width: $fontSizeMd;
        height: $fontSizeMd;

        line-height: 1;
        color: $content7;

        transition: transform 320ms cubic-bezier(0.32, 0.72, 0, 1);
    }

    // A plus rotated to a cross when the row is open: the mark itself says
    // which way the row is going, so it needs no second glyph.
    &_disclosure[open] &_caret {
        transform: rotate(45deg);
    }

    &_answer {
        margin: 0;

        // Top padding is zero: the summary above already carries $space6, and
        // doubling it opens a gap that reads as a missing element.
        padding: 0 $space6 $space6;

        font-size: $fontSizeMd;
        line-height: $lineHeightMd;
        color: $content6;
        text-wrap: pretty;
    }

    @media (prefers-reduced-motion: reduce) {
        &_question, &_caret {
            transition: none;
        }

        &_question:active {
            transform: none;
        }
    }
}
</style>
