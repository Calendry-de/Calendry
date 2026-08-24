/**
 * The locale to format dates and times in.
 *
 * WHY THIS IS NOT JUST `navigator.language`
 *
 * The schedule renders on the SERVER first. `navigator` does not exist there,
 * and Node's default locale is not the viewer's — so formatting with the
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
 * It would almost always be identical — `navigator.language` is the first entry
 * of `Accept-Language` — so the only reliable effect would be re-rendering
 * every date on every load to produce the same text. Where they DO differ, the
 * header is the better answer anyway: it is what the user configured their
 * browser to request content in.
 */
const FALLBACK = 'en-GB';

export function useViewerLocale() {
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

/**
 * The first tag from an `Accept-Language` header.
 *
 * Quality values are deliberately ignored: browsers send their preferred tag
 * first, and honouring `q=` would mean ranking languages this app does not
 * translate into. The tag is used for NUMBER AND DATE SHAPE, not for
 * translation — "5 Oct" versus "Oct 5" versus "10月5日".
 */
export function parseAcceptLanguage(header: string | undefined): string | null {
    const first = header?.split(',')[0]?.split(';')[0]?.trim();

    if (!first) {
        return null;
    }

    // A malformed header must not reach Intl, which throws a RangeError on an
    // invalid tag and would take the whole page down for a bad request header.
    try {
        return new Intl.DateTimeFormat(first).resolvedOptions().locale;
    } catch {
        return null;
    }
}
