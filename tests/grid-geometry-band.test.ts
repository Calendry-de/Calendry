import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { useGridGeometry } from '../app/composables/gridGeometry';
import type { TimeGrid } from '../app/composables/schedule';

/**
 * `minHeight` is arithmetic on MINUTES, but a multi-row grid area also holds the
 * row gaps between those rows and any height a row gained from another column's
 * crowding. Neither is a minute, so a two-block session drew as ending early;
 * only the browser can measure them, which is why the fix is `align-self`.
 */
const grid: TimeGrid = {
    id: 'g',
    name: 'Test',
    blockLengthMinutes: 45,
    blocksPerDay: 8,
    activeDays: [1, 2, 3, 4, 5],
    startHour: 8,
    startMinute: 0,
    breakMinutes: 15,
    isDefault: true,
};

const geometry = (rowHeight = 60) => useGridGeometry(ref(grid), ref(rowHeight));

describe('bandWithin: filling the rows a session spans', () => {
    it('stretches a session that spans several blocks whole', () => {
        // Two 45-minute blocks are 120px of minutes, but their area also holds
        // the hairline between them.
        // area they occupy also holds the hairline between them, so a fixed
        // height can only ever fall short of the block boundary.
        const { bandWithin } = geometry();

        expect(bandWithin(1, 0, 2).alignSelf).toBe('stretch');
        expect(bandWithin(1, 3, 4).alignSelf).toBe('stretch');
    });

    it('does NOT stretch a single-block session', () => {
        // The opposite bug: a lone session in a row another column made tall
        // would fill the row instead of showing its own duration.
        // some other column made tall would fill the row rather than showing
        // its own duration.
        const { bandWithin } = geometry();

        expect(bandWithin(1, 0, 1).alignSelf).toBe('start');
        expect(bandWithin(1, 5, 1).alignSelf).toBe('start');
        // A degenerate span is one block, not zero.
        expect(bandWithin(1, 2, 0).alignSelf).toBe('start');
    });

    it('does NOT stretch a band that leaves part of its rows free', () => {
        // Stretching would claim back time the band deliberately leaves free.
        // stretching would claim the time back.
        const { bandWithin } = geometry();
        const first = 8 * 60;

        // Starts 15 minutes into the first of two blocks.
        expect(bandWithin(1, 0, 2, first + 15).alignSelf).toBe('start');
        // Ends 15 minutes before the second block closes.
        expect(bandWithin(1, 0, 2, first, first + 90).alignSelf).toBe('start');
    });

    it('still measures extent in true minutes, breaks included', () => {
        // `stretch` lifts a floor; it does not replace the arithmetic. The
        // minimum stays proportional to real elapsed time.
        // arithmetic: the minimum stays proportional to real elapsed time, so
        // the picture is still minute-true before any row grows.
        const { bandWithin } = geometry();

        // 45 minutes at 60px per block = 1.333px per minute.
        expect(bandWithin(1, 0, 1).minHeight).toBe('60.00px');
        // Two blocks plus the 15-minute break between them: 105 minutes.
        expect(bandWithin(1, 0, 2).minHeight).toBe('140.00px');
        // Offsets are measured from the first block's own start.
        expect(bandWithin(1, 0, 2, 8 * 60 + 15).marginTop).toBe('20.00px');
    });
});
