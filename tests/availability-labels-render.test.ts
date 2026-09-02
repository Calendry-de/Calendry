import { describe, expect, it } from 'vitest';
import { createI18n } from 'vue-i18n';
import type { Translate } from '../app/composables/i18n';
import type { TimeGrid } from '../app/composables/schedule';
import { describePreferences, describeWindow } from '../app/utils/availabilityLabels';
import en from '../i18n/locales/en';

/**
 * The sentences issue #19's extraction RESTRUCTURED, rendered against the real
 * catalogue.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE INTEGRATION SUITES. Most of the
 * extraction moved a string from a template into a JSON file, and the ~200
 * copy assertions in the integration tests already pin those: if a value
 * changed by a character, a page assertion fails. These cases are the ones
 * where that is NOT true, because the string was rebuilt rather than moved:
 *
 *   - `describeWindow` no longer concatenates `'every day'`, `'all day'`, the
 *     word `block` and a `', weeks …'` clause; it picks ONE of eight complete
 *     messages by which axes are populated. A wrong branch produces a
 *     grammatical English sentence about the wrong window, which no page
 *     assertion would notice.
 *   - every plural was a hand-built `week{{ n === 1 ? '' : 's' }}` and is now a
 *     vue-i18n `|` message. A message whose forms are in the wrong ORDER, or
 *     which has too few of them, renders plausible text for the count the
 *     author happened to try and the wrong text for every other count.
 *
 * AND IT GUARDS THE GERMAN PASS, which is the more valuable half. The German
 * tree currently holds a byte-identical copy of English; when it is translated,
 * a form silently reordered or dropped is INVISIBLE by reading the JSON, and
 * `tests/i18n-catalogue.test.ts` can only count `|`-separated forms, never
 * check which count selects which. Adding the German assertions here is a
 * two-line change once that pass lands.
 *
 * The integration suites cannot cover any of this in this environment: they
 * abort at import without `TEST_MIGRATION_DATABASE_URL`, and every one of them
 * needs a seeded database and a running server.
 */
const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } as never });

/**
 * The real `t`, resolved from the real English tree, rather than a stub: a
 * `(key) => key` stub proves a call site asks for A key and nothing about
 * whether that key exists, interpolates, or pluralises.
 */
const t = i18n.global.t as unknown as Translate;

/** 08:00, eight 45-minute blocks, no break overrides: enough for `blockTime`. */
const GRID: TimeGrid = {
    id: 'grid',
    name: 'Default',
    blockLengthMinutes: 45,
    blocksPerDay: 8,
    activeDays: [1, 2, 3, 4, 5],
    startHour: 8,
    startMinute: 0,
    breakMinutes: 0,
    isDefault: true,
};

describe('describeWindow picks one of eight whole sentences', () => {
    /*
     * THE EMPTINESS CONVENTION IS THE THING UNDER TEST. On the wire an empty
     * axis means EVERY value on it, so each of these eight rows is a different
     * window and the eight messages exist so that none of them has to be
     * assembled from the others' fragments.
     */
    it.each([
        [
            'every axis empty: the whole week, all day',
            { days: [], blocks: [], weeks: [] },
            'every day, all day',
        ],
        [
            'weeks only: specific weeks, otherwise blanket',
            { days: [], blocks: [], weeks: [0, 1] },
            'every day, all day, weeks 1, 2',
        ],
        [
            'blocks only: that time of day, every day',
            { days: [], blocks: [0], weeks: [] },
            'every day, block 1 (08:00–08:45)',
        ],
        [
            'blocks and weeks, no day axis',
            { days: [], blocks: [0], weeks: [1] },
            'every day, block 1 (08:00–08:45), weeks 2',
        ],
        [
            'days only: the whole of those days',
            { days: [5], blocks: [], weeks: [] },
            'Friday, all day',
        ],
        [
            'days and weeks, whole day',
            { days: [5], blocks: [], weeks: [1] },
            'Friday, all day, weeks 2',
        ],
        [
            'days and blocks: the ordinary case',
            { days: [1, 5], blocks: [0, 1], weeks: [] },
            'Monday, Friday, block 1 (08:00–08:45), 2 (08:45–09:30)',
        ],
        [
            'all three axes',
            { days: [1], blocks: [7], weeks: [2] },
            'Monday, block 8 (13:15–14:00), weeks 3',
        ],
    ])('%s', (_name, window, expected) => {
        expect(describeWindow(t, window, GRID)).toBe(expected);
    });

    it('numbers blocks from 1 without a grid to read times from', () => {
        // The no-TimeGrid tenant renders honestly rather than blank; the
        // sentence is the same shape, only the block list is bare.
        expect(describeWindow(t, { days: [], blocks: [0, 2], weeks: [] }, null))
            .toBe('every day, block 1, 3');
    });
});

describe('describePreferences keeps the weight clause byte-identical', () => {
    it('names an overridden multiplier exactly as the API test asserts', () => {
        // `tests/person-availability-api.test.ts` matches 'counts 1.5×' in the
        // rendered staff page, so this value is load-bearing beyond this file.
        expect(describePreferences(t, {
            preferredDays: [1],
            preferredBlocks: [],
            weightMultiplier: 1.5,
        }, null)).toBe('Monday · counts 1.5×');
    });

    it('says nothing about the weight on the default, so overrides stand out', () => {
        expect(describePreferences(t, {
            preferredDays: [1],
            preferredBlocks: [],
            weightMultiplier: null,
        }, null)).toBe('Monday');
    });

    it('reports the empty state as prose, never as an empty line', () => {
        expect(describePreferences(t, null, null)).toBe('No preferences set');
    });
});

/*
 * EVERY PLURAL BOUNDARY THE EXTRACTION TOUCHED.
 *
 * Each was an inline `{{ n === 1 ? '' : 's' }}`, which is a word split across
 * an expression and therefore had no key at all. The counts asserted here are
 * the boundaries, not samples: one either side of every form break, plus zero
 * wherever a zero form exists, because a three-form message with its zero and
 * one forms transposed renders correctly for exactly one of them.
 */
describe('plural forms select on the count', () => {
    it.each([
        ['my.availability.submit', 0, 'Submit for approval'],
        ['my.availability.submit', 1, 'Submit for approval'],
        ['my.availability.submit', 2, 'Submit 2 entries for approval'],
        ['my.apiTokens.permissionCount', 1, '1 permission'],
        ['my.apiTokens.permissionCount', 2, '2 permissions'],
        ['my.apiTokens.noticeAllSelected', 1, 'Selected the one permission you hold.'],
        ['my.apiTokens.noticeAllSelected', 2, 'Selected all 2 permissions you hold.'],
        ['my.apiTokens.enableAllAria', 1, 'Enable the one permission you hold'],
        ['my.apiTokens.enableAllAria', 2, 'Enable all 2 permissions you hold'],
        ['my.apiTokens.disableAllAria', 1, 'Disable the one permission you selected'],
        ['my.apiTokens.disableAllAria', 2, 'Disable all 2 permissions you selected'],
        ['my.icsLinks.scopeRolling', 1, 'All terms · next 1 week'],
        ['my.icsLinks.scopeRolling', 2, 'All terms · next 2 weeks'],
    ])('%s at %i', (key, count, expected) => {
        expect(t(key as never, { count })).toBe(expected);
    });

    /*
     * The API-token presets' three outcomes, which must stay three sentences: a
     * preset applied IN FULL and one applied PARTIALLY are different facts
     * about the token being minted, and a form break in the wrong place is how
     * they come to read alike. `presetApplyAria` carries a zero form because
     * the button stays enabled for a preset the caller holds nothing of, which
     * is exactly the case that has to say so rather than appear inert.
     */
    it('declines the token-preset outcomes, including the zero form', () => {
        expect(t('my.apiTokens.presetApplyAria', { preset: 'Read-only', count: 0, total: 5 }))
            .toBe('Apply Read-only: selects none of the 5 permissions in it, because you hold none of them');
        expect(t('my.apiTokens.presetApplyAria', { preset: 'Read-only', count: 1, total: 5 }))
            .toBe('Apply Read-only: selects the one permission you hold of the 5 in it');
        expect(t('my.apiTokens.presetApplyAria', { preset: 'Read-only', count: 3, total: 5 }))
            .toBe('Apply Read-only: selects the 3 permissions you hold of the 5 in it');

        expect(t('my.apiTokens.noticePresetFull', { preset: 'Read-only', count: 1 }))
            .toBe('Applied Read-only in full: its one permission is selected.');
        expect(t('my.apiTokens.noticePresetFull', { preset: 'Read-only', count: 4 }))
            .toBe('Applied Read-only in full: all 4 of its permissions are selected.');

        expect(t('my.apiTokens.noticePresetPartial', { preset: 'Read-only', count: 1, total: 5 }))
            .toBe('Applied Read-only partially: you hold 1 of the 5 permissions in it.');
        expect(t('my.apiTokens.noticePresetMissing', { count: 1, keys: 'room.read' }))
            .toBe('The remaining one is not selected, because you do not hold it: room.read');
        expect(t('my.apiTokens.noticePresetMissing', { count: 2, keys: 'room.read, term.read' }))
            .toBe('The remaining 2 are not selected, because you do not hold them: room.read, term.read');

        expect(t('my.apiTokens.noticePresetEmpty', { preset: 'Read-only', count: 1 }))
            .toBe('Nothing selected: you do not hold the one permission Read-only needs.');
        expect(t('my.apiTokens.noticePresetEmpty', { preset: 'Read-only', count: 5 }))
            .toBe('Nothing selected: you hold none of the 5 permissions Read-only needs.');
    });

    it('states the blocked-slot meter, with and without the week-scoped aside', () => {
        // Two shapes rather than a parenthetical appended to one: the aside has
        // to agree with the sentence it sits in.
        expect(t('my.availability.meter', { blocked: 3, total: 40 }))
            .toBe('3 of 40 teaching slots blocked');
        expect(t('my.availability.meterWithWeekScoped', { blocked: 3, total: 40, count: 1 }))
            .toBe('3 of 40 teaching slots blocked (1 week-specific entry not counted)');
        expect(t('my.availability.meterWithWeekScoped', { blocked: 3, total: 40, count: 2 }))
            .toBe('3 of 40 teaching slots blocked (2 week-specific entries not counted)');
    });

    it('declines the submitted notice, and states the remainder when there is one', () => {
        expect(t('my.availability.submitted', { count: 1 }))
            .toBe('Entry submitted for approval. Nothing is blocked until an administrator approves it.');
        expect(t('my.availability.submitted', { count: 2 }))
            .toBe('2 entries submitted for approval. Nothing is blocked until an administrator approves it.');
        expect(t('my.availability.submittedPartly', { count: 1, failed: 2 }))
            .toBe('Entry submitted. 2 still on the grid; press again to retry.');
        expect(t('my.availability.submittedPartly', { count: 3, failed: 1 }))
            .toBe('3 entries submitted. 1 still on the grid; press again to retry.');
    });

    it('pluralises the holiday row, which names a term it does not translate', () => {
        expect(t('my.availability.holidayRow', { term: 'Winter', weeks: '3', count: 1 }))
            .toBe('Winter: week 3, away all day');
        expect(t('my.availability.holidayRow', { term: 'Winter', weeks: '3, 4', count: 2 }))
            .toBe('Winter: weeks 3, 4, away all day');
    });

    it('pluralises the holiday preview head around its term name', () => {
        // Rendered through `<i18n-t :plural>` in the component so the term stays
        // a `<strong>`; the message and its form selection are the same either
        // way, which is what this asserts.
        expect(t('availability.holidayForm.previewHead', { term: 'Winter', count: 1 }))
            .toBe('Winter · 1 week blocked');
        expect(t('availability.holidayForm.previewHead', { term: 'Winter', count: 4 }))
            .toBe('Winter · 4 weeks blocked');
    });

    it('carries the over-block warning\'s own verb AND pronoun in each form', () => {
        // The case `i18n/CONVENTIONS.md` uses as its worked example: this was
        // `'One week is'`/`` `${n} weeks are` `` and `'it'`/`'them'` interleaved
        // with the prose, so neither English half was a sentence and no German
        // one could be written at all.
        expect(t('availability.holidayForm.partialWarning', { count: 1 })).toBe(
            'One week is blocked in full even though your absence covers only part of it.'
            + ' A week is blocked if your absence touches it at all: the scheduler cannot be'
            + ' told about part of a week in one entry.',
        );
        expect(t('availability.holidayForm.partialWarning', { count: 3 })).toBe(
            '3 weeks are blocked in full even though your absence covers only part of them.'
            + ' A week is blocked if your absence touches it at all: the scheduler cannot be'
            + ' told about part of a week in one entry.',
        );
    });
});

describe('the term conjunction folds correctly past two items', () => {
    /**
     * Mirrors `joinWithAnd` in `AvailabilityHolidayForm.vue`, which cannot be
     * imported: this repo has no component-mounting harness, by the standing
     * decision recorded in `tests/preference-weight-multiplier.test.ts`. One
     * line, restated rather than left uncovered, because a pairwise fold is
     * exactly the construct that reads correctly at length two and wrongly at
     * three, and `join(' and ')` (what it replaced) left an English word in
     * every language.
     */
    const joinWithAnd = (names: string[]) => names
        .reduce((list, next) => t('availability.holidayForm.termListJoin', { list, next }));

    it.each([
        [['Winter'], 'Winter'],
        [['Winter', 'Summer'], 'Winter and Summer'],
        [['Winter', 'Summer', 'Autumn'], 'Winter and Summer and Autumn'],
    ])('%j', (names, expected) => {
        expect(joinWithAnd(names)).toBe(expected);
    });

    it('is what the spanning-terms refusal reads as', () => {
        expect(t('availability.holidayForm.problemSpansTerms', { terms: joinWithAnd(['Winter', 'Summer']) }))
            .toBe('That range spans Winter and Summer. Enter one absence per term.'
                + ' A single entry counts the weeks of one term only.');
    });
});
