import { describe, expect, it } from 'vitest';
import { NAV_GROUPS } from '../app/utils/navGroups';
import { isSidebarPlace, navPlaces } from '../app/utils/navPlaces';

/**
 * `CommonAppShell`'s sidebar must offer every destination the registry has.
 *
 * WHY THIS FILE EXISTS
 *
 * The sidebar renders `NAV_GROUPS`, matching each group's `paths` against the
 * permission-filtered entry list. A path no group claims is not rendered,
 * silently, with no warning, no empty group and no gap. The link simply is not
 * there, and because the header and Ctrl+K read the registry directly rather
 * than the grouping, the route stays reachable by two other means. So the
 * symptom is "the nav feels incomplete", which nobody files.
 *
 * `/manage/data-export` shipped in exactly that state. It was in the registry,
 * gated on `tenant.export`, reachable from the dashboard cards and the command
 * palette, and absent from the app's one persistent nav because nobody added
 * its path to a group. The shell's own comment had predicted this failure mode
 * in prose, which is checked by nobody: CLAUDE.md's standing warning about
 * exactly that.
 *
 * TWO FAILURE MODES, BOTH CHECKED, because they are opposites:
 *
 *   unclassified  a destination no group claims: invisible in the sidebar
 *   dead path     a group path matching no entry: a typo or a deleted route,
 *                 which fails the same way and is just as quiet
 *
 * This is a UNIT test: `navPlaces()` and `isSidebarPlace()` are pure module
 * level, so nothing here needs a Nuxt instance, a session or the database.
 * That is why they live in `~/utils/navPlaces` rather than inside the
 * composable's computed, where no test could reach them.
 */
describe('sidebar grouping covers the navigation registry', () => {
    // `navPlaces()` takes `t` as a parameter rather than calling `useT()`,
    // which is what keeps it callable from plain Node (see `NavTranslate` in
    // that module). This test measures PATHS and sections, never copy, so the
    // translator returns the key itself: no message catalogue, no vue-i18n,
    // and nothing here to update when a label's wording changes.
    const places = navPlaces((key) => key);
    const sidebarPaths = places.filter(isSidebarPlace).map((entry) => entry.to as string);
    const groupedPaths = NAV_GROUPS.flatMap((group) => group.paths);

    it('has entries and groups to check at all', () => {
        // Guards the guard: every assertion below is a loop, and a loop over an
        // empty list passes. Same reasoning as manage-relation-gates.test.ts:
        // an import that silently resolved to nothing would make this whole
        // file green and worthless.
        expect(places.length).toBeGreaterThan(20);
        expect(sidebarPaths.length).toBeGreaterThan(20);
        expect(NAV_GROUPS.length).toBeGreaterThan(3);
    });

    it('classifies every sidebar destination into a group', () => {
        const unclassified = sidebarPaths.filter((path) => !groupedPaths.includes(path));

        // Named rather than counted: the failure message has to say WHICH route
        // vanished, because the whole point is that the symptom does not.
        expect(unclassified, 'routes in the registry that no NAV_GROUPS entry claims, so they never render in the sidebar').toEqual([]);
    });

    it('names no path that is not a destination', () => {
        const dead = groupedPaths.filter((path) => !sidebarPaths.includes(path));

        expect(dead, 'NAV_GROUPS paths matching no registry entry: a typo drops the link exactly as silently as omitting it').toEqual([]);
    });

    it('claims each destination exactly once', () => {
        // Two groups claiming one path renders the link twice, in two different
        // headings. Not fatal, but it is a grouping that has stopped meaning
        // anything, and it happens while moving a route between groups.
        const duplicates = groupedPaths.filter((path, index) => groupedPaths.indexOf(path) !== index);

        expect(duplicates, 'paths claimed by more than one NAV_GROUPS entry').toEqual([]);
    });

    it('excludes home and the account actions, matching the sidebar itself', () => {
        // `isSidebarPlace` is the shared predicate, so this pins what it means
        // rather than restating it: home is excluded (a page linking to itself)
        // and so is every `account` entry (actions, not places). If this drifts,
        // the two checks above are measuring the wrong set.
        expect(sidebarPaths).not.toContain('/dashboard');
        expect(places.some((entry) => entry.section === 'account')).toBe(false);
    });
});
