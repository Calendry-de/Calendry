import { describe, expect, it } from 'vitest';
import {
    ROOM_PLAN_DEFAULTS,
    clampRoomPlanColumnWidth,
    clampRoomPlanRotateSeconds,
    roomPlanColumnsPerPage,
    roomPlanEntryPhase,
    roomPlanHourHeight,
    roomPlanHourMarks,
    roomPlanLanes,
    roomPlanNowOffset,
    roomPlanOutsideWindow,
    roomPlanPage,
    roomPlanPageCount,
    roomPlanPageRange,
    roomPlanPlacement,
    roomPlanWindow,
} from '../app/utils/roomPlan';

/**
 * The room plan's arithmetic (`app/utils/roomPlan.ts`), which is the whole
 * reason that file exists separately from `ScreenRoomPlan.vue`: this suite has
 * no component-mounting harness (no `@vue/test-utils`, no `happy-dom`: the
 * same reason `tests/availability-labels-render.test.ts` tests its sentences
 * through the real catalogue rather than through a mount), and a wall display
 * is the one surface in this product where nobody is watching for a drawing
 * bug. Every case below is a property the picture depends on:
 *
 *  - a window that clipped an entry would DELETE a lesson from a corridor wall,
 *  - a lane count that ignored an overlap would draw one booking over another
 *    and hide a double-booked room,
 *  - a page count that disagreed with the slice would leave dots claiming rooms
 *    that are never shown,
 *  - an unclamped URL knob would divide by zero or draw a 1px column.
 */
const entry = (startMinute: number, endMinute: number) => ({ startMinute, endMinute });

describe('the day window', () => {
    it("is the grid's own day, on whole hours", () => {
        expect(roomPlanWindow([], { startMinute: 8 * 60 + 15, endMinute: 16 * 60 + 45 })).toEqual({
            startMinute: 8 * 60,
            endMinute: 17 * 60,
        });
    });

    it('widens to cover an entry outside the grid rather than clipping it', () => {
        /*
         * The case that matters: a Session placed before the grid opens or
         * after it closes (a grid narrowed under an existing Session, an event
         * created off grid). Clipping it would remove it from the wall with
         * nothing to say it was ever there.
         */
        const window = roomPlanWindow(
            [entry(7 * 60 + 30, 8 * 60), entry(17 * 60, 20 * 60 + 30)],
            { startMinute: 8 * 60, endMinute: 16 * 60 },
        );

        expect(window).toEqual({ startMinute: 7 * 60, endMinute: 21 * 60 });
    });

    it('falls back to a working day with no grid and no entries', () => {
        expect(roomPlanWindow([], { startMinute: null, endMinute: null }))
            .toEqual(ROOM_PLAN_DEFAULTS.window);
    });

    it('is never shorter than an hour, whatever it is given', () => {
        const window = roomPlanWindow([entry(600, 600)], { startMinute: null, endMinute: null });

        expect(window.endMinute - window.startMinute).toBeGreaterThanOrEqual(60);
    });

    it('obeys a configured window instead of widening to the entries', () => {
        /*
         * THE POINT OF CONFIGURING ONE. A screen told to draw 08:00-16:00 must
         * draw exactly that, however late the one evening lab runs: the reason
         * somebody sets a window is to make the drawn hours bigger, and an
         * outlier that silently restored the whole day would make the setting
         * look broken.
         */
        const window = roomPlanWindow(
            [entry(9 * 60, 10 * 60), entry(20 * 60, 21 * 60 + 30)],
            { startMinute: 7 * 60, endMinute: 22 * 60 },
            { startMinute: 8 * 60, endMinute: 16 * 60 },
        );

        expect(window).toEqual({ startMinute: 8 * 60, endMinute: 16 * 60 });
    });

    it('takes one configured end and derives the other', () => {
        const window = roomPlanWindow(
            [entry(9 * 60, 10 * 60)],
            { startMinute: 7 * 60, endMinute: 18 * 60 },
            { startMinute: 8 * 60, endMinute: null },
        );

        expect(window).toEqual({ startMinute: 8 * 60, endMinute: 18 * 60 });
    });

    it('counts what a configured window crops, and nothing when it crops nothing', () => {
        const entries = [entry(9 * 60, 10 * 60), entry(15 * 60, 17 * 60), entry(20 * 60, 21 * 60)];
        const cropped = { startMinute: 8 * 60, endMinute: 16 * 60 };

        // The 20:00 lab is gone entirely; the 15:00-17:00 one merely overhangs
        // the edge, and counts too, because its drawn block stops at 16:00 and
        // would read as ending there.
        expect(roomPlanOutsideWindow(entries, cropped)).toBe(2);
        expect(roomPlanOutsideWindow(entries, { startMinute: 8 * 60, endMinute: 22 * 60 })).toBe(0);
    });

    it('never reports a crop for a derived window, which widens instead', () => {
        const entries = [entry(7 * 60, 8 * 60), entry(20 * 60, 21 * 60)];
        const derived = roomPlanWindow(entries, { startMinute: 8 * 60, endMinute: 16 * 60 });

        expect(roomPlanOutsideWindow(entries, derived)).toBe(0);
    });

    it('marks every whole hour in the window and never the closing edge', () => {
        expect(roomPlanHourMarks({ startMinute: 9 * 60, endMinute: 12 * 60 }))
            .toEqual([9 * 60, 10 * 60, 11 * 60]);
    });
});

describe('the vertical scale', () => {
    const window = { startMinute: 8 * 60, endMinute: 18 * 60 };

    it('fills the measured height', () => {
        // Ten hours into 700px is 70px an hour, and the plan is exactly as
        // tall as the space it was given.
        expect(roomPlanHourHeight(700, window)).toBe(70);
    });

    it('stops compressing at the floor, so the plan scrolls instead', () => {
        expect(roomPlanHourHeight(120, window)).toBe(ROOM_PLAN_DEFAULTS.hourHeight.min);
    });

    it('uses the default before anything has been measured', () => {
        expect(roomPlanHourHeight(0, window)).toBe(ROOM_PLAN_DEFAULTS.hourHeight.default);
    });

    it('places an entry minute-true at a constant scale', () => {
        // 09:30–11:00 at 60px an hour, on a window opening at 08:00.
        expect(roomPlanPlacement(entry(9 * 60 + 30, 11 * 60), window, 60))
            .toEqual({ top: 90, height: 90 });
    });

    it('gives a very short entry a readable minimum without moving its start', () => {
        const placement = roomPlanPlacement(entry(8 * 60, 8 * 60 + 5), window, 60);

        expect(placement.top).toBe(0);
        expect(placement.height).toBeGreaterThan(5);
    });

    it('draws no now line outside the day', () => {
        expect(roomPlanNowOffset(6 * 60, window, 60)).toBeNull();
        expect(roomPlanNowOffset(23 * 60, window, 60)).toBeNull();
        expect(roomPlanNowOffset(9 * 60, window, 60)).toBe(60);
    });
});

describe('the phase of an entry', () => {
    it('is past only once it has ended, and now on its own boundary', () => {
        const lesson = entry(9 * 60, 10 * 60);

        expect(roomPlanEntryPhase(lesson, 8 * 60)).toBe('future');
        expect(roomPlanEntryPhase(lesson, 9 * 60)).toBe('now');
        expect(roomPlanEntryPhase(lesson, 9 * 60 + 59)).toBe('now');
        // Ends AT 10:00: the minute it ends it is over, matching the server's
        // own `isNow` (`minutesNow >= start && minutesNow < end`).
        expect(roomPlanEntryPhase(lesson, 10 * 60)).toBe('past');
    });
});

describe('lanes inside one room', () => {
    it('leaves a clean day in one lane', () => {
        const lanes = roomPlanLanes([entry(9 * 60, 10 * 60), entry(10 * 60, 11 * 60)]);

        expect(lanes.map((placed) => placed.lane)).toEqual([0, 0]);
        expect(lanes.map((placed) => placed.lanes)).toEqual([1, 1]);
    });

    it('splits a double-booked room rather than drawing one over the other', () => {
        const lanes = roomPlanLanes([entry(9 * 60, 11 * 60), entry(10 * 60, 12 * 60)]);

        expect(lanes.map((placed) => placed.lane)).toEqual([0, 1]);
        expect(lanes.map((placed) => placed.lanes)).toEqual([2, 2]);
    });

    it('confines the split to the clash, not the whole day', () => {
        /*
         * One clash in the morning must not halve the width of the afternoon:
         * lanes are counted per overlap cluster. This is the property that
         * makes lanes usable at all on a narrow column.
         */
        const lanes = roomPlanLanes([
            entry(9 * 60, 11 * 60),
            entry(10 * 60, 12 * 60),
            entry(14 * 60, 16 * 60),
        ]);

        expect(lanes.map((placed) => placed.lanes)).toEqual([2, 2, 1]);
        expect(lanes[2]!.lane).toBe(0);
    });

    it('reuses a lane a finished entry has freed', () => {
        const lanes = roomPlanLanes([
            entry(9 * 60, 12 * 60),
            entry(10 * 60, 11 * 60),
            entry(11 * 60, 12 * 60),
        ]);

        expect(lanes.map((placed) => placed.lane)).toEqual([0, 1, 1]);
        expect(lanes.map((placed) => placed.lanes)).toEqual([2, 2, 2]);
    });

    it('orders by start time whatever order it is handed', () => {
        const lanes = roomPlanLanes([entry(14 * 60, 15 * 60), entry(9 * 60, 10 * 60)]);

        expect(lanes.map((placed) => placed.entry.startMinute)).toEqual([9 * 60, 14 * 60]);
    });
});

describe('paging the rooms', () => {
    const rooms = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

    it('shows every room before anything has been measured', () => {
        // SSR and the first frame: a guessed page size would drop rooms from
        // the server-rendered plan for a reason the client cannot reconstruct.
        expect(roomPlanColumnsPerPage(0, 176, rooms.length)).toBe(rooms.length);
        expect(roomPlanPageCount(rooms.length, rooms.length)).toBe(1);
    });

    it('fits as many columns as the configured width allows', () => {
        expect(roomPlanColumnsPerPage(1000, 176, rooms.length)).toBe(5);
        expect(roomPlanColumnsPerPage(1000, 320, rooms.length)).toBe(3);
    });

    it('never asks for more columns than there are rooms', () => {
        expect(roomPlanColumnsPerPage(4000, 176, 3)).toBe(3);
    });

    it('always draws at least one column, however narrow the plan gets', () => {
        expect(roomPlanColumnsPerPage(80, 176, rooms.length)).toBe(1);
    });

    it('counts pages so the dots and the slices agree', () => {
        const perPage = roomPlanColumnsPerPage(1000, 176, rooms.length);
        const pages = roomPlanPageCount(rooms.length, perPage);

        expect(pages).toBe(2);

        const shown = Array.from({ length: pages }, (_, page) => roomPlanPage(rooms, page, perPage));

        expect(shown).toEqual([['a', 'b', 'c', 'd', 'e'], ['f', 'g']]);
        // Every room reachable, none twice: what the rotation promises.
        expect(shown.flat()).toEqual(rooms);
    });

    it('names the rooms a dot stands for, bounded by the real count', () => {
        expect(roomPlanPageRange(0, 5, 7)).toEqual({ from: 1, to: 5 });
        expect(roomPlanPageRange(1, 5, 7)).toEqual({ from: 6, to: 7 });
    });

    it('reports one page for no rooms at all, rather than none', () => {
        expect(roomPlanPageCount(0, 5)).toBe(1);
    });
});

describe('the URL knobs', () => {
    it('defaults when the query says nothing usable', () => {
        for (const raw of [undefined, null, '', 'wide', Number.NaN]) {
            expect(clampRoomPlanColumnWidth(raw)).toBe(ROOM_PLAN_DEFAULTS.columnWidth.default);
        }

        expect(clampRoomPlanRotateSeconds(undefined)).toBe(ROOM_PLAN_DEFAULTS.rotateSeconds.default);
    });

    it('clamps a column width into legible bounds', () => {
        expect(clampRoomPlanColumnWidth('240')).toBe(240);
        expect(clampRoomPlanColumnWidth('1')).toBe(ROOM_PLAN_DEFAULTS.columnWidth.min);
        expect(clampRoomPlanColumnWidth('99999')).toBe(ROOM_PLAN_DEFAULTS.columnWidth.max);
    });

    it('reads zero, and only zero, as "hold on one page"', () => {
        expect(clampRoomPlanRotateSeconds('0')).toBe(0);
        expect(clampRoomPlanRotateSeconds('-5')).toBe(0);
        expect(clampRoomPlanRotateSeconds('1')).toBe(ROOM_PLAN_DEFAULTS.rotateSeconds.min);
        expect(clampRoomPlanRotateSeconds('20')).toBe(20);
    });
});
