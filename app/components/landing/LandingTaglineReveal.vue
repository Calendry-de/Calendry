<template>
    <section
        ref="root"
        class="tagline"
        :aria-label="lines.join(' ')"
    >
        <p
            class="tagline_measure"
            :class="{ 'tagline_measure--armed': armed }"
        >
            <span
                v-for="line in wordLines"
                :key="line.key"
                class="tagline_line"
            >
                <span
                    v-for="word in line.words"
                    :key="word.key"
                    class="tagline_word"
                    :class="{ 'tagline_word--lit': word.index < lit }"
                >{{ word.text }}</span>
            </span>
        </p>
    </section>
</template>

<script setup lang="ts">
import { landingTagline } from '~/utils/landingContent';
import { useT } from '~/composables/i18n';

/**
 * The page's one large-type moment: the core benefit, stated as its own beat.
 *
 * WHY IT IS NOT THE HERO. The hero says what the software does; this says what
 * it is FOR, and the design system requires the two to be separate moments
 * rather than stacked paragraphs. It sits after the benefits, where a reader
 * has just been given five specifics and is ready for the sentence that ties
 * them together.
 *
 * WORDS LIGHT UP IN READING ORDER, ONE AT A TIME, driven by the section's own
 * progress through the viewport rather than by each word's geometry. That
 * distinction is the whole implementation:
 *
 *   An `IntersectionObserver` per word is the obvious build and it does not
 *   produce this effect. A word's intersection is decided by its VERTICAL
 *   position, and every word on one line shares that, so a line of eight words
 *   fires as one block of eight. Reading order is horizontal, so the trigger
 *   has to be the section's scroll progress, which is a single number, not
 *   eight geometries.
 *
 * So: one scroll listener, throttled through `requestAnimationFrame`, which is
 * the other implementation the design system sanctions. Never an unthrottled
 * scroll handler; the listener is `passive`, does no layout write, and reads
 * one `getBoundingClientRect` per frame it actually runs.
 *
 * THE REST STATE IS FULLY LIT, and that is deliberate, not a fallback nobody
 * thought about. `armed` starts false, so the server renders every word at full
 * colour and a reader with no JavaScript, or with reduced motion, or on a
 * browser that never fires the handler, gets a legible sentence. Muting happens
 * only once the component is mounted AND has decided it can animate: the same
 * rule the CSS reveal mixin follows, where the state a browser without
 * scroll-driven animations shows is "arrived", never blank. Priming the words
 * muted in the HTML would mean a JavaScript failure renders the page's largest
 * sentence at 30% contrast.
 *
 * `aria-label` on the section carries the whole sentence, and the words are
 * split for presentation. A screen reader reading eight separate spans would
 * hear the sentence as a list; the visual split is not information.
 */
const { t } = useT();

const tagline = computed(() => landingTagline(t));
const lines = computed(() => [tagline.value.lineOne, tagline.value.lineTwo]);

/**
 * Words, numbered continuously ACROSS both lines, because reading order does
 * not restart at the second line.
 *
 * Split on whitespace, which is safe to do to a translated sentence in a way
 * that splitting on characters would not be. `filter` drops the empty strings a
 * double space would otherwise produce, so a stray space cannot consume one of
 * the reveal's steps and stall the sentence for a whole word's worth of scroll.
 */
const wordLines = computed(() => {
    let index = 0;

    return lines.value.map((line, lineIndex) => ({
        key: `line-${ lineIndex }`,
        words: line.split(/\s+/u).filter(Boolean).map((text) => ({
            key: `word-${ index }`,
            text,
            index: index++,
        })),
    }));
});

const wordCount = computed(() => wordLines.value.reduce((total, line) => total + line.words.length, 0));

const root = useTemplateRef<HTMLElement | null>('root');
const armed = ref(false);
const lit = ref(0);

/**
 * How many words are lit, from the section's position in the viewport.
 *
 * The band runs from the section's top edge reaching 85% of the viewport height
 * to it reaching 35%: the sentence finishes lighting while it is still above
 * the middle of the screen, for the reason the reveal mixin gives about its own
 * range. A reveal still running under the reader's eye is a distraction rather
 * than an entrance.
 */
function measure(): void {
    const element = root.value;

    if (!element) {
        return;
    }

    const viewport = window.innerHeight;
    const { top } = element.getBoundingClientRect();
    const start = viewport * 0.85;
    const end = viewport * 0.35;
    const progress = (start - top) / (start - end);

    lit.value = Math.max(0, Math.min(wordCount.value, Math.round(progress * wordCount.value)));
}

onMounted(() => {
    // Reduced motion keeps the rest state: every word lit, no listener attached
    // at all, rather than a listener that lights them all on the first frame.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return;
    }

    armed.value = true;

    let queued = false;

    const onScroll = (): void => {
        if (queued) {
            return;
        }

        queued = true;

        requestAnimationFrame(() => {
            queued = false;
            measure();
        });
    };

    measure();

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    onBeforeUnmount(() => {
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onScroll);
    });
});
</script>

<style scoped lang="scss">
.tagline {
    // The quiet ground, on purpose. This band is loud in TYPE and nowhere else:
    // the page's two inverse bands are the hero and the closing action, and a
    // third would stop either of them reading as a boundary.
    padding: $space13 $space7;

    @include mobileOnly {
        padding: $space11 $space5;
    }

    &_measure {
        // The hero's measure, per the design system: the tagline is capped like
        // the headline so its lines break where the thought breaks.
        max-width: 680px;
        margin: 0 auto;

        font-size: $fontSize4Xl;
        font-weight: 600;
        line-height: $lineHeight4Xl;
        color: $typographyPrimary;
        letter-spacing: -0.02em;

        @include mobile {
            font-size: $fontSize3Xl;
            line-height: $lineHeight3Xl;
        }

        @include mobileOnly {
            font-size: $fontSize2Xl;
            line-height: $lineHeight2Xl;
        }
    }

    &_line {
        display: block;
    }

    /*
     * A word is inline-block so its own transition cannot be split across a
     * line break, and it carries the trailing space as a margin rather than as
     * text, so the space is not itself a fading glyph.
     */
    &_word {
        display: inline-block;
        margin-right: 0.25em;
        transition: opacity 500ms cubic-bezier(0.32, 0.72, 0, 1);
    }

    /*
     * ONLY ARMED COMPONENTS MUTE. Without this class every word is at full
     * opacity, which is what the server renders and what a reader with no
     * JavaScript keeps. 0.3 is the muted tone the design system asks for,
     * stated as opacity against the theme's own ink so it is correct in both
     * themes without a second colour.
     */
    &_measure--armed &_word {
        opacity: 0.3;

        &--lit {
            opacity: 1;
        }
    }
}
</style>
