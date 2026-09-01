/**
 * Whether the app shell's sidebar is collapsed to an icon rail.
 *
 * A COOKIE, not localStorage, and that is the whole reason this is a composable
 * rather than three lines in the component. The server can read a cookie, so
 * the rail renders collapsed in the SSR response and the first paint is already
 * correct. `localStorage` is unreadable during SSR, so it would ship the
 * expanded sidebar, then snap to the rail on hydration: a visible jump on every
 * page load, on the one piece of chrome that is present on every page.
 *
 * Same mechanism and the same options as `useThemeCookie` in
 * `~/composables/layout` for exactly the same reason. Unlike the theme this
 * needs no store copy, because nothing reads it through `useHead` to emit
 * custom properties: the cookie ref IS the state, so there is no second value
 * to keep in step.
 */
export type NavRailState = 'open' | 'rail';

export function useNavRailCookie() {
    return useCookie<NavRailState>('nav_rail', {
        path: '/',
        sameSite: 'lax',
        secure: true,
        maxAge: 60 * 60 * 24 * 360,
    });
}

/**
 * SYNCHRONOUS and called at setup, per CLAUDE.md: `useCookie` needs the Nuxt
 * instance, so the ref has to be taken here and closed over. Calling it from
 * inside the click handler is the "composable called outside a setup function"
 * trap.
 *
 * Absent cookie means EXPANDED. A first-time visitor should see the labels;
 * the rail is a choice someone makes after they know the sections by their
 * icons, never the state they are dropped into.
 */
export function useNavRail() {
    const cookie = useNavRailCookie();

    const collapsed = computed(() => cookie.value === 'rail');

    function toggle() {
        cookie.value = collapsed.value ? 'open' : 'rail';
    }

    return { collapsed, toggle };
}

/**
 * Which sidebar topics are collapsed.
 *
 * PERSISTENCE IS NOT OPTIONAL HERE, which is the difference from the
 * dashboard's own collapsible groups. `CommonAppShell` remounts on every
 * navigation, so a plain `<details open>` would spring back open the moment the
 * reader clicked any link in it: the control would appear to work and then
 * undo itself, which is worse than not having it.
 *
 * A cookie again, for the same SSR reason as the rail: the server renders the
 * collapsed state directly, so there is no expanded-then-snap flash on a
 * surface that is present on every page. `useCookie` serializes the array
 * itself, so labels containing spaces and an ampersand ("Access & review")
 * need no escaping of ours.
 *
 * Keyed by LABEL rather than by index: `NAV_GROUPS` order can change, and an
 * index would silently transfer a reader's collapsed state to whichever topic
 * moved into that slot.
 */
export function useNavGroupCollapse() {
    const closed = useCookie<string[]>('nav_closed', {
        path: '/',
        sameSite: 'lax',
        secure: true,
        maxAge: 60 * 60 * 24 * 360,
        default: () => [],
    });

    function isClosed(label: string): boolean {
        return (closed.value ?? []).includes(label);
    }

    /**
     * Driven by the native `toggle` event, so it records what the element
     * actually did rather than guessing. Writes only on a real change: binding
     * `:open` back into the same `<details>` re-fires `toggle`, and an
     * unconditional write would then feed itself.
     */
    function setOpen(label: string, open: boolean) {
        const current = closed.value ?? [];

        if (open === !current.includes(label)) {
            return;
        }

        closed.value = open
            ? current.filter((entry) => entry !== label)
            : [...current, label];
    }

    return { isClosed, setOpen };
}
