/**
 * Where a Session's colour comes from, decided in one place.
 *
 * WHY THIS IS SHARED AND NOT A COMPONENT DETAIL
 * ---------------------------------------------
 * Four surfaces draw a Session — the week grid, the day agenda, the inspector
 * and the review diff — and a chip that is teal in one and violet in another is
 * not a styling inconsistency, it is two different claims about the same thing.
 * The order lives here so all four read it rather than each deciding.
 *
 * THE ORDER IS TENANT-STATED, NOT HARDCODED. `colorSourceOrder` comes from
 * `tenant_display_settings` and defaults to `['offering', 'kind']`: the more
 * specific source wins, which is the ordinary expectation, but an institution
 * that colours strictly by activity type can say `['kind']` and mean it.
 *
 * NULL IS A REAL ANSWER at every level. An Offering with no colour is asking to
 * inherit, not asking for grey — which is why every source is nullable and the
 * fallback happens here rather than in a `??` at each call site.
 */

export type ColorSource = 'offering' | 'kind';

export const COLOR_SOURCES: readonly ColorSource[] = ['offering', 'kind'];

/** The tenant's display preferences, or the defaults for a tenant that has none. */
export interface DisplaySettings {
    highlightOnline: boolean;
    onlineColor: string | null;
    colorSourceOrder: string[];
    defaultColor: string | null;
}

export const DISPLAY_DEFAULTS: DisplaySettings = {
    highlightOnline: true,
    onlineColor: null,
    colorSourceOrder: ['offering', 'kind'],
    defaultColor: null,
};

export interface ColorableSession {
    offering?: { color?: string | null } | null;
    kind?: { color?: string | null } | null;
}

/**
 * The colour to draw this Session in, or null to leave it to the stylesheet.
 *
 * Returns NULL rather than a hex fallback when nothing supplies one: the
 * stylesheet's neutral is a themed token that changes with the ground, and
 * baking a hex here would freeze one theme's value into the markup.
 */
export function resolveSessionColor(
    session: ColorableSession,
    settings: DisplaySettings = DISPLAY_DEFAULTS,
): string | null {
    for (const source of settings.colorSourceOrder) {
        const value = source === 'offering'
            ? session.offering?.color
            : source === 'kind'
                ? session.kind?.color
                : null;

        if (value) {
            return value;
        }
    }

    return settings.defaultColor ?? null;
}

/**
 * How this Session is delivered, as far as the ROOMS can say.
 *
 * THREE STATES, NOT TWO, and the third is why. Online delivery is a virtual Room
 * (TAXONOMY.md), so a Session booked into a lecture hall AND a virtual room is
 * neither on-site nor online — it is streamed, and calling it either is a false
 * claim about where people are expected to be. Measured on real tenant data,
 * EVERY session touching the virtual room was of exactly this kind, so a
 * two-state rule marked nothing at all and the feature was invisible.
 *
 * The tenant setting governs whether any of this is DRAWN, never whether it is
 * true — the truth lives in the room assignment and nowhere else.
 */
export type DeliveryMode = 'onsite' | 'hybrid' | 'online';

export function deliveryMode(
    rooms: { isVirtual?: boolean }[] | undefined,
    settings: DisplaySettings = DISPLAY_DEFAULTS,
): DeliveryMode {
    if (!settings.highlightOnline || !rooms?.length) {
        // No rooms is "unplaced", which is a different fact from "on site" — but
        // it is not a delivery mode either, and the off-grid tray is where that
        // one is reported.
        return 'onsite';
    }

    const virtual = rooms.filter((room) => room.isVirtual === true).length;

    if (virtual === 0) {
        return 'onsite';
    }

    return virtual === rooms.length ? 'online' : 'hybrid';
}

/** True only for a Session delivered ENTIRELY online. See `deliveryMode`. */
export function isOnlineSession(
    rooms: { isVirtual?: boolean }[] | undefined,
    settings: DisplaySettings = DISPLAY_DEFAULTS,
): boolean {
    return deliveryMode(rooms, settings) === 'online';
}
