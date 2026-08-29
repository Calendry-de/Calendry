import type { UnavailabilityWindow } from '#shared/availability';
import { describeWeightMultiplier } from '#shared/availability';
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
    preference: {
        preferredDays: number[];
        preferredBlocks: number[];
        weightMultiplier?: number | null;
        preferredRoomFeatureIds?: string[];
    } | null,
    grid: TimeGrid | null,
    /** Equipment id → display name, so the summary names types rather than ids. */
    roomFeatureNames?: Map<string, string>,
): string {
    const roomFeatureIds = preference?.preferredRoomFeatureIds ?? [];

    /*
     * ROOM TYPES COUNT AS A PREFERENCE. Testing the two time axes alone reported
     * "No preferences set" for somebody who had stated one — the collapsed row
     * would then contradict the editor that opens beneath it, and an
     * administrator scanning the list for who has spoken would skip them.
     */
    if (!preference
        || (!preference.preferredDays.length && !preference.preferredBlocks.length && !roomFeatureIds.length)) {
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

    if (roomFeatureIds.length) {
        // Falls back to the id only when the name map was not supplied or has
        // gone stale — visibly wrong beats silently omitted, since an omission
        // here reads as "they stated no room preference".
        parts.push(roomFeatureIds.map((id) => roomFeatureNames?.get(id) ?? id).join(', '));
    }

    /*
     * The override belongs in the COLLAPSED summary, not only in the expanded
     * editor: "who has a non-default weight" is a question about the whole list,
     * and answering it by opening five hundred rows is not answering it.
     *
     * Absent by design when there is no override — `null` is the ordinary state
     * and naming it on every row would bury the exceptions it exists to reveal.
     * A multiplier cannot appear without a preference, since clearing both axes
     * deletes the row it lives on.
     */
    const weight = describeWeightMultiplier(preference.weightMultiplier);

    if (weight) {
        parts.push(weight);
    }

    return parts.join(' · ');
}
