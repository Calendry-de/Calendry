import type { UnavailabilityWindow } from '#shared/availability';
import type { Translate } from '~/composables/i18n';
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
 *
 * ONE MESSAGE PER SHAPE, NOT A SENTENCE GLUED FROM FRAGMENTS (issue #19). This
 * used to build the line from `'every day'`, `'all day'`, a `', weeks …'`
 * clause and the word `block`, which is untranslatable: a German translator
 * handed those pieces cannot decide word order, case or the preposition, because
 * the grammar lives in the concatenation rather than in any of the strings. So
 * the three axes decide WHICH complete message is asked for (2 day forms × 2
 * block forms × 2 week forms = 8), and only the value LISTS are interpolated.
 * More keys than there were literals, deliberately: each one is a whole
 * sentence a translator can move around freely.
 *
 * `t` is threaded rather than resolved here, per `i18n/CONVENTIONS.md`: this is
 * a plain module, so `useT()` is illegal in it.
 */
export function describeWindow(t: Translate, window: UnavailabilityWindow, grid: TimeGrid | null): string {
    const days = window.days.map((day) => weekdayName(day)).join(', ');

    const blocks = window.blocks.map((index) => (grid
        ? `${index + 1} (${blockTime(grid, index).start}–${blockTime(grid, index).end})`
        : String(index + 1))).join(', ');

    const weeks = window.weeks.map((week) => week + 1).join(', ');

    if (window.days.length) {
        if (window.blocks.length) {
            return window.weeks.length
                ? t('availability.windowSummary.daysBlocksWeeks', { days, blocks, weeks })
                : t('availability.windowSummary.daysBlocks', { days, blocks });
        }

        return window.weeks.length
            ? t('availability.windowSummary.daysWholeDayWeeks', { days, weeks })
            : t('availability.windowSummary.daysWholeDay', { days });
    }

    if (window.blocks.length) {
        return window.weeks.length
            ? t('availability.windowSummary.everyDayBlocksWeeks', { blocks, weeks })
            : t('availability.windowSummary.everyDayBlocks', { blocks });
    }

    return window.weeks.length
        ? t('availability.windowSummary.everyDayWholeDayWeeks', { weeks })
        : t('availability.windowSummary.everyDayWholeDay');
}

/**
 * Preferences as a sentence, with the OPPOSITE emptiness rule.
 *
 * Empty means "no preference" here, not "every value": see the two model
 * comments. Kept next to `describeWindow` on purpose: the two functions are
 * where the inversion is easiest to see and hardest to get wrong by accident.
 *
 * WHY THIS IS NOT EIGHT SHAPE MESSAGES THE WAY `describeWindow` IS. The two
 * functions look alike and are not: `describeWindow` builds one clause whose
 * grammar spans the axes, while this builds a BULLETED LIST of items that are
 * each already complete and independent (a list of weekday names, a list of
 * blocks with their times, tenant-named equipment, and the weight clause). The
 * only app-authored words here are the empty state and the weight, so those are
 * the two keys; ` · ` between finished items is punctuation, not grammar, and
 * keying the fourteen present/absent combinations would produce fourteen
 * messages containing nothing for a translator to translate.
 */
export function describePreferences(
    t: Translate,
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
     * "No preferences set" for somebody who had stated one; the collapsed row
     * would then contradict the editor that opens beneath it, and an
     * administrator scanning the list for who has spoken would skip them.
     */
    if (!preference
        || (!preference.preferredDays.length && !preference.preferredBlocks.length && !roomFeatureIds.length)) {
        return t('availability.preferenceSummary.emptyHint');
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
        // gone stale: visibly wrong beats silently omitted, since an omission
        // here reads as "they stated no room preference".
        parts.push(roomFeatureIds.map((id) => roomFeatureNames?.get(id) ?? id).join(', '));
    }

    /*
     * The override belongs in the COLLAPSED summary, not only in the expanded
     * editor: "who has a non-default weight" is a question about the whole list,
     * and answering it by opening five hundred rows is not answering it.
     *
     * Absent by design when there is no override: `null` is the ordinary state
     * and naming it on every row would bury the exceptions it exists to reveal.
     * A multiplier cannot appear without a preference, since clearing both axes
     * deletes the row it lives on.
     */
    if (preference.weightMultiplier != null) {
        parts.push(t('availability.preferenceSummary.weight', {
            // Stringified here rather than handed to the message as a number:
            // the value is a factor the reader compares (`1.5`), not a quantity
            // to be formatted per locale, and `formatNumber()` is the only place
            // this app formats numbers against a viewer's tag.
            value: String(preference.weightMultiplier),
        }));
    }

    return parts.join(' · ');
}
