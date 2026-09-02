/**
 * One definition of "what counts as a password" and one generator, shared by the
 * browser and the server.
 *
 * IN `shared/` BECAUSE THREE PLACES MUST NOT DISAGREE: the write boundary that
 * validates a supplied password (`server/utils/accountAdmin.ts`), the
 * public change-password route, and the management form that generates one and
 * tells the admin the floor. A second copy of the number is a form that accepts
 * eleven characters and an API that refuses them, with the error landing on a
 * field the user filled in correctly by the rule they were shown.
 *
 * `crypto.getRandomValues` rather than `node:crypto`, for the same reason: it is
 * the one CSPRNG both runtimes have. Node has exposed it on `globalThis.crypto`
 * since 18, and in a browser it exists only in a secure context, which every
 * page serving this application already is.
 */

/** Matches the floor `/api/auth/change-password` enforces on a self-chosen one. */
export const PASSWORD_MIN_LENGTH = 12;

/**
 * A one-time password: 16 random bytes, base64url, 128 bits of entropy.
 *
 * base64url so it survives being copied out of a terminal, pasted into a form,
 * or read aloud over a phone without a quoting question: the three ways an
 * initial password actually travels. Never stored in the clear anywhere; the
 * caller shows it once and hashes it.
 */
export function randomPassword(): string {
    const bytes = new Uint8Array(16);

    crypto.getRandomValues(bytes);

    return btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}
