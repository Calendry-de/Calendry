import { describe, expect, it } from 'vitest';
import { FAN_LIMIT, clusterSlots } from '../app/composables/gridGeometry';

/**
 * `clusterSlots` decides what a reader sees when a slot is crowded, and its
 * promise is that NOTHING IS EVER HIDDEN: density changes, count does not. Easy
 * to break with an off-by-one or a slice, so it is asserted rather than trusted.
 */
const rowSpan = (start: number, span: number) => `${start + 2} / ${start + 2 + Math.max(1, span)}`;
const band = () => ({ marginTop: '0.00px', minHeight: '60.00px', alignSelf: 'start' } as const);

/** Rows a slot's `grid-row` covers, read back out of the emitted style. */
function rowsOf(slot: { style: Record<string, string> }): { from: number; to: number } {
    const [from, to] = slot.style.gridRow!.split('/').map((part) => Number(part.trim()));

    return { from: from!, to: to! };
}

/** Slots for items placed at given (start, span) pairs. */
function slotsFrom(spans: Array<{ start: number; span: number }>) {
    const items = spans.map((span, index) => ({ id: `s${index}`, ...span }));

    return clusterSlots(
        items,
        (item) => ({ key: item.id, start: item.start, span: item.span }),
        { column: '2', rowSpan, band, dayKey: 1 },
    );
}

function slotsFor(count: number, opts: { start?: number; span?: number } = {}) {
    const items = Array.from({ length: count }, (_, index) => ({ id: `s${index}` }));

    return clusterSlots(
        items,
        (item) => ({ key: item.id, start: opts.start ?? 0, span: opts.span ?? 1 }),
        { column: '2', rowSpan, band, dayKey: 1 },
    );
}

const rendered = (slots: ReturnType<typeof slotsFor>) => slots
    .reduce((total, slot) => total + slot.items.length, 0);

describe('clusterSlots at the edges', () => {
    it('renders every item, at every crowding level up to absurd', () => {
        // One, the fan limit, one past it, and a slot nobody designed for.
        // limit, one past it, and a slot nobody designed for.
        for (const count of [1, 2, 3, 4, 5, 12, 40, 200, 1000]) {
            expect(rendered(slotsFor(count)), `${count} overlapping items`).toBe(count);
        }
    });

    it('fans up to the limit and stacks past it', () => {
        expect(slotsFor(FAN_LIMIT).every((slot) => !slot.compact)).toBe(true);
        expect(slotsFor(FAN_LIMIT).length).toBe(FAN_LIMIT);

        const crowded = slotsFor(FAN_LIMIT + 1);

        // Past the limit it is ONE slot carrying everything, not N slivers.
        expect(crowded.length).toBe(1);
        expect(crowded[0]!.compact).toBe(true);
        expect(crowded[0]!.items).toHaveLength(FAN_LIMIT + 1);
    });

    it('never emits a slot with no items', () => {
        // An empty slot is invisible but still intercepts clicks.
        // can still intercept a click.
        for (const count of [1, 3, 4, 40]) {
            expect(slotsFor(count).every((slot) => slot.items.length > 0)).toBe(true);
        }
    });

    it('gives every slot a unique key', () => {
        // Duplicate keys make Vue render one node for two items: a missing
        // session, with no error anywhere.
        // failure mode is a missing session, with no error anywhere.
        for (const count of [3, 4, 40, 200]) {
            const keys = slotsFor(count).map((slot) => slot.key);

            expect(new Set(keys).size, `${count} items`).toBe(keys.length);
        }
    });

    it('handles a degenerate span without collapsing the slot', () => {
        // `Math.max(1, span)` exists because a zero-height slot is unclickable.
        // because a zero-height slot is unclickable and invisible.
        const zero = slotsFor(1, { span: 0 });

        expect(zero).toHaveLength(1);
        expect(zero[0]!.style.gridRow).toBe('2 / 3');
    });

    it('separates clusters that do not overlap in time', () => {
        const items = [
            { id: 'early', start: 0, span: 1 },
            { id: 'late', start: 4, span: 1 },
        ];
        const slots = clusterSlots(
            items,
            (item) => ({ key: item.id, start: item.start, span: item.span }),
            { column: '2', rowSpan, band, dayKey: 1 },
        );

        // A gap with nothing running closes a cluster, so an 09:00 session must
        // not be narrowed by a 14:00 one it never overlaps.
        // closes a cluster, so an 09:00 session must not be narrowed by a 14:00
        // one it never overlaps.
        expect(slots).toHaveLength(2);
        expect(slots.every((slot) => slot.style.width === '100%')).toBe(true);
    });
});

describe('a crowded cluster stays a time grid', () => {
    /*
     * The reported bug, from a real week: 16 sessions at 09:45, 3 at 10:30 and 1
     * at 11:45 formed one cluster, drawn as ONE slot spanning 09:45–12:30 with
     * everything in list order, so chips sat in rows contradicting their own
     * printed time, and the spanned break rows inflated to absorb the content.
     */
    const crowded = [
        // Long enough to make this ONE transitive cluster, not three.
        // thing ONE transitive cluster rather than three independent ones.
        ...Array.from({ length: 16 }, () => ({ start: 0, span: 3 })),
        ...Array.from({ length: 3 }, () => ({ start: 2, span: 3 })),
        { start: 4, span: 1 },
    ];

    it('keeps every compact slot inside a single row', () => {
        // A compact slot may not span a row it does not start in.
        // does not start in, which is what stopped breaks being spanned and
        // inflated.
        const slots = slotsFrom(crowded);

        expect(slots.every((slot) => slot.compact)).toBe(true);

        for (const slot of slots) {
            const { from, to } = rowsOf(slot);

            expect(to - from, `slot ${slot.key} spans ${to - from} rows`).toBe(1);
        }
    });

    it('puts each member in the row of its OWN start block', () => {
        const slots = slotsFrom(crowded);

        // One slot per distinct start block, not one per cluster.
        expect(slots).toHaveLength(3);

        // `rowSpan` here is `start + 2`, so the row identifies the start block.
        const byRow = new Map(slots.map((slot) => [rowsOf(slot).from - 2, slot.items.length]));

        expect(byRow.get(0)).toBe(16);
        expect(byRow.get(2)).toBe(3);
        expect(byRow.get(4)).toBe(1);
    });

    it('still renders every member, and each exactly once', () => {
        // Splitting by start block must not drop or duplicate a member.
        // the count. Splitting by start block must not drop or duplicate one.
        const slots = slotsFrom(crowded);
        const ids = slots.flatMap((slot) => slot.items.map((item) => item.id));

        expect(ids).toHaveLength(crowded.length);
        expect(new Set(ids).size).toBe(crowded.length);
        expect(new Set(slots.map((slot) => slot.key)).size).toBe(slots.length);
    });

    it('does not go compact until the fan limit is passed', () => {
        // Fanned slots keep their real duration; this must NOT be flattened.
        // keeps its real duration; this is the case that must NOT be flattened.
        const slots = slotsFrom([
            { start: 0, span: 3 }, { start: 1, span: 3 }, { start: 2, span: 3 },
        ]);

        expect(slots.every((slot) => !slot.compact)).toBe(true);
        expect(slots.every((slot) => rowsOf(slot).to - rowsOf(slot).from === 3)).toBe(true);
    });

    it('orders a block\'s stack totally, so SSR and the client agree', () => {
        // A partial comparator leaves ties in input order, which differs between
        // SSR and the client and surfaces as a hydration mismatch.
        // which differs between the server render and the client's and shows up
        // as a hydration mismatch rather than as a layout bug.
        const forward = slotsFrom(Array.from({ length: 5 }, () => ({ start: 0, span: 1 })));
        const items = [4, 3, 2, 1, 0].map((index) => ({ id: `s${index}`, start: 0 }));
        const reversed = clusterSlots(
            items,
            (item) => ({ key: item.id, start: item.start, span: 1 }),
            { column: '2', rowSpan, band, dayKey: 1 },
        );

        expect(reversed[0]!.items.map((item) => item.id))
            .toEqual(forward[0]!.items.map((item) => item.id));
    });
});
