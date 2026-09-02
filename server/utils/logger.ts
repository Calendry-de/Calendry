import pino from 'pino';

/**
 * The one structured logger for the server. Every `console.*` call site in
 * `server/` (except `accountAdmin.ts`'s `auditAccount()`, issue #78's audit
 * log conversion, not this one's) goes through this instead.
 *
 * Level from `LOG_LEVEL`, defaulting to `info`. Not wired to `NODE_ENV`,
 * because "quiet in prod" and "quiet in dev" are two different decisions an
 * operator or a developer might each want independently, and one env var
 * already means both here.
 *
 * Output is pino's default (newline-delimited JSON), no pretty-printing
 * transport, so a container's log collector gets one structured line per
 * event with no extra dependency or config surface.
 */
export const logger = pino({
    level: process.env.LOG_LEVEL ?? 'info',
});
