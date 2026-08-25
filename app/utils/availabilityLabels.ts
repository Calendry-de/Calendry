import type { UnavailabilityWindow } from '#shared/availability';
import type { TimeGrid } from '~/composables/schedule';
import { blockTime, weekdayName } from '~/composables/schedule';

/**
 * One window as a sentence.
 *
 * THE EMPTY AXIS IS THE HARD PART. On the wire an empty array means EVERY value
 * on that axis, so `{days:[5], blocks:[]}` is the whole of Friday and
 * `{days:[], blocks:[0]}` is the first block of every day. A control that
 * renders an empty array as "none" says the exact opposite of what the row
 * means, which is why this is one function every screen calls rather than three
 * template expressions that each got it right at the time.
 */
export function describeWindow(window: UnavailabilityWindow, grid: TimeGrid | null): string {
    const days = window.days.length
        ? window.days.map((day) => weekdayName(day)).join(', ')
        : 'every day';

    const blocks = window.blocks.length
        ? window.blocks.map((index) => (grid
            ? `${index + 1} (${blockTime(grid, index).start}–${blockTime(grid, index).end})`
            : String(index + 1))).join(', ')
        : 'all day';

    const weeks = window.weeks.length
        ? `, weeks ${window.weeks.map((week) => week + 1).join(', ')}`
        : '';

    return window.blocks.length
        ? `${days}, block ${blocks}${weeks}`
        : `${days}, ${blocks}${weeks}`;
}

/**
 * Preferences as a sentence, with the OPPOSITE emptiness rule.
 *
 * Empty means "no preference" here, not "every value" — see the two model
 * comments. Kept next to `describeWindow` on purpose: the two functions are
 * where the inversion is easiest to see and hardest to get wrong by accident.
 */
export function describePreferences(
    preference: { preferredDays: number[]; preferredBlocks: number[] } | null,
    grid: TimeGrid | null,
): string {
    if (!preference || (!preference.preferredDays.length && !preference.preferredBlocks.length)) {
        return 'No preferences set';
    }

    const parts: string[] = [];

    if (preference.preferredDays.length) {
        parts.push(preference.preferredDays.map((day) => weekdayName(day)).join(', '));
    }

    if (preference.preferredBlocks.length) {
        parts.push(preference.preferredBlocks
            .map((index) => (grid ? `${index + 1} (${blockTime(grid, index).start})` : String(index + 1)))
            .join(', '));
    }

    return parts.join(' · ');
}
