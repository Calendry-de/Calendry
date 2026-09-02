/**
 * Locale resolution (issue #17).
 *
 * `parseAcceptLanguage` is the ORIGINAL implementation from
 * `app/composables/locale.ts` (`useViewerLocale`'s header-only, hydration-safe
 * mechanism), relocated here unchanged so `server/api/auth/session.get.ts` can
 * use the identical parser: `server/` cannot import from `app/`. This is the
 * "in shared/ because two consumers must not drift" reasoning
 * `shared/constraintTypes.ts` already states for the same structural reason.
 *
 * `resolveLocale` is the new layer issue #17 asks for: a Person's own
 * `locale` wins if set, then the tenant's `defaultLocale`, then this same
 * header parse, then the existing fallback, extending `useViewerLocale`'s
 * header-only resolution rather than replacing it. See that composable's own
 * doc comment for why the whole thing has to be resolved once, server-side,
 * and carried to the client rather than re-resolved there.
 */
export const FALLBACK_LOCALE = 'en-GB';

/**
 * The first tag from an `Accept-Language` header.
 *
 * Quality values are deliberately ignored: browsers send their preferred tag
 * first, and honouring `q=` would mean ranking languages this app does not
 * translate into. The tag is used for NUMBER AND DATE SHAPE, not for
 * translation: "5 Oct" versus "Oct 5" versus "10月5日".
 */
export function parseAcceptLanguage(header: string | undefined | null): string | null {
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

/**
 * Same validate-via-round-trip technique as `parseAcceptLanguage`, applied to
 * a STORED value (`Person.locale` / `TenantDisplaySettings.defaultLocale`)
 * rather than a header: a stale or hand-edited row must degrade to the next
 * source, not throw. Exported so the write boundary (both settings routes)
 * can refuse a value that would only ever degrade, rather than storing one
 * silently ignored at read time.
 */
export function isUsableLocale(value: string | null | undefined): value is string {
    if (!value) {
        return false;
    }

    try {
        new Intl.DateTimeFormat(value);

        return true;
    } catch {
        return false;
    }
}

export function resolveLocale(sources: {
    personLocale?: string | null;
    tenantDefaultLocale?: string | null;
    acceptLanguage?: string | null;
}): string {
    if (isUsableLocale(sources.personLocale)) {
        return sources.personLocale;
    }

    if (isUsableLocale(sources.tenantDefaultLocale)) {
        return sources.tenantDefaultLocale;
    }

    return parseAcceptLanguage(sources.acceptLanguage) ?? FALLBACK_LOCALE;
}
