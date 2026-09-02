import { describe, expect, it } from 'vitest';
import {
    COLOR_SOURCES,
    DISPLAY_DEFAULTS,
    deliveryMode,
    isOnlineSession,
    resolveSessionColor,
} from '../shared/sessionColor';

/**
 * The colour a Session is drawn in, and the two rules that make it mean
 * something.
 *
 * A pure unit test: no server, no database. It exists because four surfaces
 * draw a Session (week grid, day agenda, inspector, review diff) and a chip
 * that is teal in one and violet in another is not a styling inconsistency, it
 * is two different claims about the same thing.
 *
 * The regression it pins specifically: the chip used to read
 * `session.kind?.color ?? primary500`, so every Session without a kind colour
 * claimed the brand accent: the one colour DESIGN.md reserves for "where a
 * session may land". Measured on real tenant data, every chip on the screen
 * carried it. `resolveSessionColor` returning NULL rather than a hex fallback
 * is what stops that, so that is asserted first.
 */
describe('resolveSessionColor', () => {
    it('returns null when nothing supplies a colour, never a fallback accent', () => {
        expect(resolveSessionColor({ offering: null, kind: null })).toBeNull();
        expect(resolveSessionColor({})).toBeNull();
        expect(resolveSessionColor({ offering: { color: null }, kind: { color: null } })).toBeNull();
    });

    it('prefers the more specific source by default', () => {
        expect(resolveSessionColor({
            offering: { color: '#BE6E45' },
            kind: { color: '#3389C6' },
        })).toBe('#BE6E45');
    });

    it('treats a null colour as INHERIT rather than as "no colour"', () => {
        // The whole reason every colour column is nullable: an Offering with no
        // colour is asking for its kind's, not asking for grey.
        expect(resolveSessionColor({
            offering: { color: null },
            kind: { color: '#3389C6' },
        })).toBe('#3389C6');
    });

    it('honours a tenant that colours strictly by activity type', () => {
        const kindOnly = { ...DISPLAY_DEFAULTS, colorSourceOrder: ['kind'] };

        expect(resolveSessionColor({
            offering: { color: '#BE6E45' },
            kind: { color: '#3389C6' },
        }, kindOnly)).toBe('#3389C6');
    });

    it('falls back to the tenant default only after every source is exhausted', () => {
        const withDefault = { ...DISPLAY_DEFAULTS, defaultColor: '#525255' };

        expect(resolveSessionColor({ offering: { color: '#BE6E45' } }, withDefault)).toBe('#BE6E45');
        expect(resolveSessionColor({ offering: null, kind: null }, withDefault)).toBe('#525255');
    });

    /**
     * An unknown source must be INERT, not throw and not match. The write
     * boundary rejects one, so this is the second line of defence for a row
     * written before that validation existed.
     */
    it('ignores a colour source it does not know', () => {
        const nonsense = { ...DISPLAY_DEFAULTS, colorSourceOrder: ['room', 'kind'] };

        expect(resolveSessionColor({ kind: { color: '#3389C6' } }, nonsense)).toBe('#3389C6');
    });

    it('declares exactly the sources the write boundary accepts', () => {
        // If these drift, a tenant can save a source the resolver silently
        // skips: a setting that saves, displays, and does nothing.
        expect([...COLOR_SOURCES].sort()).toEqual(['kind', 'offering']);
    });
});

/**
 * Online delivery is a virtual ROOM and never a flag on Session (TAXONOMY.md).
 * These assertions are about that boundary as much as about the rendering: the
 * function may only ever ask the rooms.
 */
describe('isOnlineSession', () => {
    it('marks a session whose every room is virtual', () => {
        expect(isOnlineSession([{ isVirtual: true }])).toBe(true);
        expect(isOnlineSession([{ isVirtual: true }, { isVirtual: true }])).toBe(true);
    });

    it('does not mark a session that is only partly online', () => {
        // A session split across a lecture hall and a virtual room is streamed,
        // not online: `deliveryMode` calls that `hybrid`.
        expect(isOnlineSession([{ isVirtual: true }, { isVirtual: false }])).toBe(false);
    });

    it('does not mark an unplaced session', () => {
        // No rooms is "nowhere", not "online": a different fact, and the one
        // `every()` on an empty array would get wrong.
        expect(isOnlineSession([])).toBe(false);
        expect(isOnlineSession(undefined)).toBe(false);
    });

    it('draws nothing when the tenant has turned the marking off', () => {
        const off = { ...DISPLAY_DEFAULTS, highlightOnline: false };

        // The setting governs whether the fact is DRAWN, never whether it is true.
        expect(isOnlineSession([{ isVirtual: true }], off)).toBe(false);
    });
});

/**
 * Three delivery states, and the third is not decoration.
 *
 * Measured on real tenant data, EVERY session touching the virtual room also had
 * a physical one, so a two-state rule marked nothing at all and the feature was
 * invisible on the only data that exists. `hybrid` is what makes the room
 * assignment legible instead of silently unrepresentable.
 */
describe('deliveryMode', () => {
    it('separates on-site, streamed and fully online', () => {
        expect(deliveryMode([{ isVirtual: false }])).toBe('onsite');
        expect(deliveryMode([{ isVirtual: false }, { isVirtual: true }])).toBe('hybrid');
        expect(deliveryMode([{ isVirtual: true }])).toBe('online');
        expect(deliveryMode([{ isVirtual: true }, { isVirtual: true }])).toBe('online');
    });

    it('reports on-site for a session with no rooms rather than inventing a mode', () => {
        // Unplaced is a different fact, and the off-grid tray is where it is
        // reported, not here, and never as "online".
        expect(deliveryMode([])).toBe('onsite');
        expect(deliveryMode(undefined)).toBe('onsite');
    });

    it('draws nothing when the tenant has turned the marking off', () => {
        const off = { ...DISPLAY_DEFAULTS, highlightOnline: false };

        expect(deliveryMode([{ isVirtual: true }], off)).toBe('onsite');
        expect(deliveryMode([{ isVirtual: true }, { isVirtual: false }], off)).toBe('onsite');
    });
});
