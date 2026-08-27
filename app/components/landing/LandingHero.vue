<template>
    <div class="hero">
        <div class="hero_measure">
            <div class="hero_copy">
                <LandingStatusBadge
                    label="In active development"
                    :detail="`v${ version }`"
                />

                <h1 class="hero_title">
                    Timetabling for schools and universities.
                </h1>

                <p class="hero_lead">
                    Calendry holds a term's timetable — rooms, cohorts, staff, courses, and your
                    own daily block structure — and a separate solver service builds one for you
                    to review, change, or throw away.
                </p>

                <p class="hero_audience">
                    For the people who actually build the timetable: registrars, timetabling
                    officers and department heads, plus the lecturers who have to live in the
                    result.
                </p>

                <div class="hero_actions">
                    <CommonButton
                        type="primary"
                        href="#contact"
                    >Get in touch</CommonButton>
                    <CommonButton
                        type="secondary"
                        href="#built"
                    >See what works today</CommonButton>
                </div>
            </div>

            <LandingHeroGrid class="hero_figure"/>
        </div>
    </div>
</template>

<script setup lang="ts">
/**
 * One sentence on what this is, one on who it is for, and the product itself.
 *
 * The figure is not decoration filling a right-hand column: it is the only
 * place on the page where a reader can see what a timetable looks like here,
 * and it carries the surface's one authored motion. See `LandingHeroGrid` for
 * why it is an abstraction rather than a screenshot.
 *
 * ORDER MATTERS AT NARROW WIDTHS. The copy comes first in the DOM and the
 * figure follows, so a phone reader meets the sentence, the audience line and
 * both buttons before the grid — the figure never pushes the primary action
 * below the fold.
 *
 * The version comes from `runtimeConfig.public.version` rather than being typed
 * in, for the same reason the review screen derives its structural-rule count
 * from the catalogue instead of writing "3": a number stated in prose is a
 * number nothing checks, and this one moves on every release.
 */
const config = useRuntimeConfig();

const version = computed(() => config.public.version);
</script>

<style scoped lang="scss">
.hero {
    padding: $space10 $space7 $space11;

    @include mobileOnly {
        padding: $space8 $space5 $space9;
    }

    &_measure {
        display: grid;
        grid-template-columns: minmax(0, 6fr) minmax(0, 5fr);
        gap: $space10;
        align-items: center;

        width: min(1040px, 100%);
        margin: 0 auto;

        @include mobile {
            grid-template-columns: minmax(0, 1fr);
            gap: $space9;
        }
    }

    &_copy {
        display: flex;
        flex-direction: column;
        gap: $space6;
        align-items: start;
    }

    &_title {
        max-width: 20ch;
        margin: 0;

        font-size: $fontSize3Xl;
        font-weight: 700;
        line-height: 1.08;
        color: $content1;
        text-wrap: balance;
        letter-spacing: -0.02em;

        @include mobile {
            max-width: 24ch;
        }

        // Was 24px here — the size of a desktop section title, which left the
        // page with no display step at all on a phone.
        @include mobileOnly {
            font-size: $fontSize2Xl;
        }
    }

    &_lead {
        max-width: 54ch;
        margin: 0;

        font-size: $fontSizeLg;
        line-height: 1.6;
        color: $content5;

        @include mobileOnly {
            font-size: $fontSizeMd;
        }
    }

    &_audience {
        max-width: 58ch;
        margin: 0;

        // The best sentence on the page was set in the tertiary text colour at
        // body size. It is the line that tells a reader whether the product is
        // for them, so it now reads as secondary rather than as metadata.
        font-size: $fontSizeMd;
        line-height: 1.75;
        color: $content6;
    }

    &_actions {
        display: flex;
        flex-wrap: wrap;
        gap: $space5;
        margin-top: $space3;
    }

    &_figure {
        @include mobile {
            order: 2;
        }
    }
}
</style>
