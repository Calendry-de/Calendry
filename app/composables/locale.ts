import { FALLBACK_LOCALE, parseAcceptLanguage } from '#shared/locale';

/**
 * The locale to format dates and times in.
 *
 * WHY THIS IS NOT JUST `navigator.language`
 *
 * The schedule renders on the SERVER first. `navigator` does not exist there,
 * and Node's default locale is not the viewer's, so formatting with the
 * "current" locale on each side produces different text for the same date, and
 * Vue patches mismatched TEXT on hydration while explicitly refusing to patch
 * mismatched ATTRIBUTES. This codebase has been bitten by that class four times
 * already; a date is exactly the kind of value where the wrong answer still
 * looks like a plausible one.
 *
 * So the locale is resolved ONCE, on the server, from the request's
 * `Accept-Language`, and travels to the client in the payload via `useState`.
 * The client hydrates with the SAME string the server rendered with, so the
 * markup matches by construction rather than by luck.
 *
 * WHY NOT REFINE TO `navigator.language` AFTER MOUNT
 *
 * It would almost always be identical, since `navigator.language` is the first
 * entry of `Accept-Language`, so the only reliable effect would be re-rendering
 * every date on every load to produce the same text. Where they DO differ, the
 * header is the better answer anyway: it is what the user configured their
 * browser to request content in.
 *
 * EXTENDED FOR ISSUE #17: a signed-in visitor's session already carries the
 * fully resolved locale (`SessionState.locale`, computed server-side by
 * `resolveLocale` from Person → Tenant → this same header parse; see
 * `shared/locale.ts`). That value wins when present; the header-only
 * `useState` below is now specifically the ANONYMOUS-route answer
 * (`auth.global.ts`'s `ANONYMOUS_ROUTES` never call `fetchSession()`, so
 * there is no session to prefer) and the value used before the session
 * finishes loading on an authenticated route.
 */
export function useViewerLocale() {
    const session = useSession();
    const header = useHeaderLocale();

    return computed(() => session.value?.locale ?? header.value);
}

const FALLBACK = FALLBACK_LOCALE;

function useHeaderLocale() {
    return useState<string>('viewer-locale', () => {
        if (import.meta.server) {
            const header = useRequestHeaders(['accept-language'])['accept-language'];

            return parseAcceptLanguage(header) ?? FALLBACK;
        }

        // Only reached when there was no server pass at all (a client-only
        // navigation into a fresh state), so `navigator` is safe here.
        return navigator?.language || FALLBACK;
    });
}

export { parseAcceptLanguage };
