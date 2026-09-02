import { entityPermission, findManageSection } from '~/utils/manageRegistry';
import { useSession } from '~/composables/session';

/**
 * Guards the /manage/[entity] routes.
 *
 * Two different failures, kept distinguishable on purpose:
 *
 *   unknown section        → 404, because /manage/widgets is a typo, not a
 *                            permission problem, and saying "no access" would
 *                            be a lie that sends the user hunting for a
 *                            permission that does not exist.
 *   no read permission     → redirect to /dashboard, matching what the
 *                            sidebar already shows: the section simply is
 *                            not there.
 *
 * This is convenience, not enforcement. Every API route re-checks the same
 * permission inside the tenant transaction; defeating this middleware reaches a
 * page whose every request 403s.
 *
 * READS `findManageSection`, NOT `findManageEntity`: both questions asked
 * here, does the section exist and what does reading it need, are structural,
 * so they are asked of the registry's wordless half rather than building its
 * whole translated copy to answer them.
 *
 * ITS OWN MESSAGE COMES FROM `$t`, NOT `useT()`: route middleware is not a
 * component setup, so `useI18n()` throws there. `app/plugins/i18n.ts` provides
 * the resolved translator for exactly this, and named middleware runs after
 * every global one, so `i18n.global.ts` has already settled the language.
 */
export default defineNuxtRouteMiddleware((to) => {
    const { $t } = useNuxtApp();
    const section = findManageSection(to.params.entity as string);

    if (!section) {
        return abortNavigation(createError({
            statusCode: 404,
            message: $t('errors.manage.unknownSection'),
        }));
    }

    const session = useSession();
    const held = new Set(session.value?.permissions ?? []);

    if (!held.has(entityPermission(section, 'read'))) {
        return navigateTo('/dashboard');
    }
});
