/**
 * A lobby display's device key.
 *
 * GENERATED IN THE BROWSER, for exactly the reason `randomPassword()` is: the
 * create page navigates to the saved row on success, so a key the SERVER
 * generated would be gone before anybody could read it, and only its SHA-256 is
 * stored, so "read it later" does not exist. Generating it client-side lets the
 * create form show the whole display URL, with a copy button, before the save
 * that makes it real.
 *
 * The server still generates one when a caller sends none, so a script or a
 * future CLI is not forced through a browser; that path returns the key in its
 * response, where there is no navigation to lose it to.
 *
 * 32 bytes rather than the password's 16. A password is typed by a person and
 * guarded by rate limiting on a login route; this travels in a URL that will sit
 * in a device's address bar for a term and answers a route with no rate limit of
 * its own, so the margin is worth the extra characters nobody has to type.
 */
export const SCREEN_KEY_MIN_LENGTH = 32;

export function randomScreenKey(): string {
    const bytes = new Uint8Array(32);

    crypto.getRandomValues(bytes);

    // base64url, so it survives being copied out of a terminal or pasted into a
    // device's browser without a quoting question, and needs no escaping in the
    // query string it lives in.
    return btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

/**
 * What a Screen draws (issue #31). Mirrors the `screen_mode` Postgres enum.
 *
 * IN `shared/`, not derived from Prisma's generated `$Enums`, because three
 * places need the same list and only one of them can import Prisma: the write
 * routes' Zod schemas (server), the management form's select options (client),
 * and `resolveScreenKey()`, which reads the column through `$queryRaw` as raw
 * text and therefore has no generated mapping to lean on.
 */
export const SCREEN_MODES = ['ROOM_BOARD', 'SUBSTITUTION_PLAN'] as const;

export type ScreenMode = (typeof SCREEN_MODES)[number];

/**
 * The mode a value names, or `null` when it names none.
 *
 * A GUARD THAT FAILS LOUDLY rather than defaulting to `ROOM_BOARD`: the value
 * arrives from `$queryRaw` as unmapped text, and coercing an unrecognised one
 * to the room board would draw a confident, wrong display instead of saying
 * that the credential is not one this version understands.
 */
export function asScreenMode(value: unknown): ScreenMode | null {
    return SCREEN_MODES.includes(value as ScreenMode) ? (value as ScreenMode) : null;
}

/** Where a screen of each mode is drawn. The address issued at creation time. */
export const SCREEN_MODE_PATHS: Record<ScreenMode, string> = {
    ROOM_BOARD: '/screen',
    SUBSTITUTION_PLAN: '/screen/substitutions',
};
