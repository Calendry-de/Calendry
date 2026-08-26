import { useCookie } from '#imports';

/**
 * "Has this browser been here before?", answered DURING SSR.
 *
 * The distinction matters more than it looks. `localStorage` is the obvious
 * place to record a first visit and it cannot be read while the page is being
 * rendered on the server, so a returning visitor would be served the opener in
 * the HTML and have it removed on hydration — a dark full-screen flash on every
 * single visit, which is worse than no opener at all. A cookie is legible to
 * the server, so a returning visitor's HTML simply never contains it.
 *
 * It is a first-party functional cookie holding the string `1` and nothing
 * else: no identifier, no timestamp, nothing that could distinguish one
 * returning visitor from another.
 */
/**
 * The stored value is the word `seen`, not `1`, and that is not cosmetic.
 * `useCookie` runs what it reads through `destr`, which parses JSON-ish
 * strings — so a cookie written as `'1'` comes back as the NUMBER 1, and
 * `value !== '1'` is then true forever. Every returning visitor reads as new
 * and gets the opener again. A value that cannot be parsed as anything but
 * itself removes the question.
 */
const SEEN = 'seen';

export function useFirstVisit(key: string, maxAgeDays = 365) {
    const seen = useCookie<string | null>(key, {
        maxAge: maxAgeDays * 24 * 60 * 60,
        sameSite: 'lax',
        path: '/',
    });

    // Read ONCE, at setup, before anything can mark it. `markSeen()` writes the
    // cookie synchronously, so a computed would flip to false mid-render and
    // tear the opener out from under its own animation.
    const isFirstVisit = seen.value !== SEEN;

    return {
        isFirstVisit,
        markSeen: () => { seen.value = SEEN; },
    };
}
