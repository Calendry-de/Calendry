<template>
    <div class="hero">
        <landing-status-badge
            label="In active development"
            :detail="`v${ version }`"
        />

        <h1 class="hero_title">
            Timetabling for schools and universities.
        </h1>

        <p class="hero_lead">
            Calendry holds a term's timetable — rooms, cohorts, staff, courses, and your own
            daily block structure — and a separate solver service builds one for you to review,
            change, or throw away.
        </p>

        <p class="hero_audience">
            For the people who actually build the timetable: registrars, timetabling officers and
            department heads, plus the lecturers who have to live in the result.
        </p>

        <div class="hero_actions">
            <common-button
                type="primary"
                href="#contact"
            >Get in touch</common-button>
            <common-button
                type="secondary"
                href="#built"
            >See what works today</common-button>
        </div>
    </div>
</template>

<script setup lang="ts">
/**
 * One sentence on what this is, one on who it is for, and a status badge that
 * says the honest thing without apologising for it.
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
    display: flex;
    flex-direction: column;
    gap: $space6;
    align-items: start;

    padding: $space10 0;

    @include mobileOnly {
        padding: $space8 0;
    }

    &_title {
        max-width: 24ch;
        margin: 0;

        font-size: $fontSize3Xl;
        font-weight: 700;
        line-height: 1.1;
        color: $content1;

        @include mobile {
            font-size: $fontSize2Xl;
        }

        @include mobileOnly {
            font-size: $fontSizeXl;
        }
    }

    &_lead {
        max-width: 62ch;
        margin: 0;

        font-size: $fontSizeLg;
        line-height: 1.6;
        color: $content5;

        @include mobileOnly {
            font-size: $fontSizeMd;
        }
    }

    &_audience {
        max-width: 62ch;
        margin: 0;

        font-size: $fontSizeMd;
        line-height: 1.7;
        color: $content7;
    }

    &_actions {
        display: flex;
        flex-wrap: wrap;
        gap: $space4;
        margin-top: $space3;
    }
}
</style>
