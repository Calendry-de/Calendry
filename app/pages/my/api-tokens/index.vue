<template>
    <CommonPage :title="t('my.apiTokens.pageTitle')">
        <p class="intro">{{ t('my.apiTokens.intro') }}</p>

        <ApiTokensPanel/>
    </CommonPage>
</template>

<script setup lang="ts">
import ApiTokensPanel from '~/components/my/ApiTokensPanel.vue';
import CommonPage from '~/components/common/CommonPage.vue';
import { useT } from '~/composables/i18n';

/**
 * A Person's own API tokens, on their own page.
 *
 * SPLIT OUT OF `/my/account`, which hosted this panel and the data export
 * below the locale form. Three unrelated things on one page is what made the
 * hub's card for it read "Your own display locale", so the two capabilities a
 * script author actually comes here for were reachable only by knowing they
 * were further down a settings page.
 *
 * GATED ON `api_token.manage_own`, via `middleware: 'my'` reading
 * `MY_SECTION_PERMISSIONS`: the ONE place a `/my/*` page's permission is
 * declared, shared with this page's nav entry so the two cannot disagree.
 *
 * This page carried NO gate and deliberately no middleware until that key
 * existed, and the reasoning was sound: a token is the caller's OWN authority
 * delegated and narrowed, never a new grant, since minting refuses any key the
 * creator does not hold and `heldPermissions()` intersects the stored ceiling
 * with the Person's live permissions on every request (CLAUDE.md § "Four
 * principals"). All still true. What changed is the question being asked: an
 * institution wants to decide who may run an unattended script at all, which
 * is a policy about the CREDENTIAL rather than about the permissions inside
 * it. See `api_token.manage_own`'s own comment in `shared/permissions.ts`.
 *
 * NOTHING HERE NEEDS A WIDER PERMISSION THAN THAT GATE. The panel calls
 * `GET`/`POST /api/me/api-tokens` and `DELETE /api/me/api-tokens/:id`, all
 * three gated on exactly this key, and it builds its checkbox list from the
 * session's own permission set rather than from `/api/persons` or the role
 * routes. So there is no fetch in the wave that a holder of the gate could be
 * refused, which is the failure CLAUDE.md § "A page must not depend on
 * permissions its own gate doesn't imply" is about.
 */
definePageMeta({ middleware: 'my' });

const { t } = useT();

// A getter, so the tab title follows a language change rather than freezing at
// whatever was active when this page first mounted.
useHead(() => ({ title: t('my.apiTokens.pageTitle') }));
</script>

<style scoped lang="scss">
.intro {
    max-width: 68ch;
    margin: 0 0 var(--space-l);

    font-size: var(--font-size-sm);
    line-height: 1.5;
    color: $content7;
}
</style>
