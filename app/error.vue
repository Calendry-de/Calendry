<template>
    <div class="fault">
        <div class="fault_measure">
            <p class="fault_code">{{ t('errors.page.code', { code: String(status) }) }}</p>

            <h1 class="fault_title">{{ copy.title }}</h1>

            <p class="fault_detail">{{ copy.detail }}</p>

            <CommonButton
                type="primary"
                @click="leave"
            >{{ t('errors.page.action') }}</CommonButton>
        </div>
    </div>
</template>

<script setup lang="ts">
import type { NuxtError } from '#app';
import { useT } from '~/composables/i18n';
import { LANDING_ROUTE } from '~/utils/routes';

/**
 * The app's error page, and the one branded 404.
 *
 * NUXT RENDERS THIS FOR EVERY UNHANDLED ERROR, on the server and on the client,
 * INSTEAD of the matched page. There was no `error.vue` at all before, so a
 * mistyped URL on the public domain rendered the framework's own default: an
 * unstyled stack-trace page in development and a bare "404 Not Found" in
 * production, on the one surface where a stranger is deciding whether this is a
 * real product.
 *
 * TWO MESSAGES, NOT A CATALOGUE OF STATUS CODES. A visitor only needs to know
 * which of two things happened: the page is not there (their link is stale), or
 * the page broke (ours). Every 4xx reads as the first and everything else as
 * the second, and the numeric code is shown quietly above the heading for
 * whoever is reporting it. Enumerating 401, 403, 410 and the rest would mean
 * writing copy for states this page cannot actually distinguish, because an
 * authenticated route that refuses redirects rather than erroring.
 *
 * NO LAYOUT, deliberately. The app shell reads a session and renders a tenant
 * switcher, and this page is reached by people with no session at all, on a
 * public domain. It also has to render when the thing that failed IS the
 * session fetch, so it depends on nothing but the message catalogue.
 *
 * `clearError` RATHER THAN A LINK. Nuxt holds the error state until it is
 * cleared; a plain `NuxtLink` navigates underneath a still-mounted error page
 * and the visitor keeps looking at the fault. `clearError({ redirect })` does
 * both halves, and it is why the control is a button rather than an anchor.
 *
 * `HOME_ROUTE` is deliberately NOT used. That constant means "where a signed-in
 * session belongs", and the reader here has no session: sending them to
 * `/dashboard` would bounce them straight to a login form they never asked for.
 * The way back from an error page on a public domain is the public page.
 */
const props = defineProps<{ error: NuxtError }>();

const { t } = useT();

const status = computed(() => props.error.statusCode ?? 500);

const copy = computed(() => {
    const notFound = status.value >= 400 && status.value < 500;

    return {
        title: notFound ? t('errors.page.notFound.title') : t('errors.page.unexpected.title'),
        detail: notFound ? t('errors.page.notFound.detail') : t('errors.page.unexpected.detail'),
    };
});

async function leave(): Promise<void> {
    await clearError({ redirect: LANDING_ROUTE });
}
</script>

<style scoped lang="scss">
.fault {
    display: flex;
    align-items: center;
    justify-content: center;

    min-height: 100vh;
    padding: $space11 $space7;

    @include mobileOnly {
        padding: $space10 $space5;
    }

    &_measure {
        display: flex;
        flex-direction: column;
        gap: $space6;
        align-items: start;

        width: min(680px, 100%);
    }

    &_code {
        margin: 0;

        font-size: $fontSizeXs;
        font-weight: 600;

        // Tabular, for the same reason every figure in the product is: the code
        // is a number being read back to somebody.
        font-variant-numeric: tabular-nums;
        line-height: $lineHeightXs;
        color: $content7;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    &_title {
        margin: 0;

        font-size: $fontSize3Xl;
        font-weight: 700;
        line-height: $lineHeight3Xl;
        color: $content2;
        text-wrap: balance;
        letter-spacing: -0.02em;

        @include mobileOnly {
            font-size: $fontSize2Xl;
            line-height: $lineHeight2Xl;
        }
    }

    &_detail {
        margin: 0;

        font-size: $fontSizeLg;
        line-height: $lineHeightLg;
        color: $content6;
        text-wrap: pretty;

        @include mobileOnly {
            font-size: $fontSizeMd;
            line-height: $lineHeightMd;
        }
    }
}
</style>
