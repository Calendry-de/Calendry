import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
    password: string,
    salt: Buffer,
    keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export const SESSION_COOKIE = 'calendry_session';
export const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

/**
 * Maximum password age before login treats an account like a forced reset —
 * issue #13 item 1. GLOBAL, not per-tenant: an Account is tenant-independent
 * (`CLAUDE.md`, "the auth plane") — one login can act in several
 * institutions, so a policy attached to it cannot be one tenant's setting
 * without meaning "whichever tenant reset it last" for everyone else.
 *
 * 90 DAYS, chosen rather than measured: current guidance (NIST 800-63B)
 * argues AGAINST forced periodic rotation in favour of length and a
 * breach-list check, which is why item 2 (complexity rules) is explicitly
 * left undecided rather than guessed at here. This value exists because the
 * card asked for expiry specifically, not because rotation is best practice —
 * document that tension rather than pretend it is settled.
 */
export const MAX_PASSWORD_AGE_MS = 1000 * 60 * 60 * 24 * 90;

/**
 * scrypt from node:crypto — memory-hard, and no third-party dependency for
 * something this security-critical. Stored as `scrypt$<salt>$<key>`, both
 * base64; the base64 alphabet contains no '$', so the format is unambiguous.
 */
export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const key = await scryptAsync(password, salt, KEY_LENGTH);

    return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
    const [algorithm, saltB64, keyB64] = stored.split('$');

    if (algorithm !== 'scrypt' || !saltB64 || !keyB64) {
        return false;
    }

    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(keyB64, 'base64');
    const actual = await scryptAsync(password, salt, expected.length);

    // Constant-time: a length-dependent early return would leak key length, and
    // a plain === would leak how much of the hash matched.
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Opaque bearer token. 32 random bytes, handed to the client once and never
 * stored — only its SHA-256 goes in the database, so a database read cannot be
 * turned into session impersonation.
 *
 * SHA-256 without a work factor is correct here (unlike for passwords): the
 * token already has 256 bits of entropy, so there is nothing to brute-force.
 */
export function generateSessionToken(): string {
    return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}
