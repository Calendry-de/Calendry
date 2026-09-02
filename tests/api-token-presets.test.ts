import { describe, expect, it } from 'vitest';
import { CRUD_RESOURCES, PERMISSION_KEYS } from '#shared/permissions';
import { API_TOKEN_PRESETS, presetKeys, resolvePreset } from '~/utils/apiTokenPresets';
import en from '../i18n/locales/en';

/**
 * The API-token presets (`app/utils/apiTokenPresets.ts`).
 *
 * WHY THIS EXISTS. A preset is a predicate over the permission catalogue, and
 * its failure mode is silent in both directions: one that matches NOTHING
 * renders as a button that selects no boxes, and one that matches too much
 * offers a token wider than the kind of work it is named for. Neither shows up
 * on screen as an error, which is precisely CLAUDE.md's "correctly found
 * nothing" and "matched nothing because of a bug" being indistinguishable.
 *
 * These are pure functions over the catalogue, so they are pinned here in
 * plain Node with no Nuxt instance and no browser: the reason the predicates
 * live in a module rather than inside the SFC at all.
 */
const CRUD_PREFIXES = new Set<string>(Object.values(CRUD_RESOURCES));

function actionOf(key: string): string {
    const segments = key.split('.');

    return segments[segments.length - 1] ?? key;
}

function prefixOf(key: string): string {
    return key.split('.')[0] ?? key;
}

function preset(id: string) {
    const found = API_TOKEN_PRESETS.find((candidate) => candidate.id === id);

    if (!found) {
        throw new Error(`no preset ${ id }`);
    }

    return found;
}

/** A dotted leaf path exists in the message tree. */
function hasMessage(path: string): boolean {
    let node: unknown = en;

    for (const segment of path.split('.')) {
        if (!node || typeof node !== 'object') {
            return false;
        }

        node = (node as Record<string, unknown>)[segment];
    }

    return typeof node === 'string';
}

describe('api token presets', () => {
    it('declares each id once', () => {
        const ids = API_TOKEN_PRESETS.map((entry) => entry.id);

        expect(new Set(ids).size).toBe(ids.length);
    });

    /*
     * The whole point of the module. A preset whose predicate stops matching
     * (a renamed prefix, a changed verb) would keep rendering, so an empty
     * match is asserted to be impossible rather than trusted to be noticed.
     */
    it('every preset matches at least one catalogue key', () => {
        for (const entry of API_TOKEN_PRESETS) {
            expect(presetKeys(entry).length, entry.id).toBeGreaterThan(0);
        }
    });

    it('every preset wants only real catalogue keys', () => {
        const catalogue = new Set<string>(PERMISSION_KEYS);

        for (const entry of API_TOKEN_PRESETS) {
            for (const key of presetKeys(entry)) {
                expect(catalogue.has(key), key).toBe(true);
            }
        }
    });

    it('has its label and hint in the English catalogue', () => {
        for (const entry of API_TOKEN_PRESETS) {
            expect(hasMessage(entry.labelKey), entry.labelKey).toBe(true);
            expect(hasMessage(entry.descriptionKey), entry.descriptionKey).toBe(true);
        }
    });

    describe('read-only', () => {
        it('wants every read-shaped key and nothing that writes', () => {
            const keys = presetKeys(preset('readOnly'));

            for (const key of keys) {
                expect(actionOf(key), key).toMatch(/^read(_|$)/);
            }

            // The three read shapes the catalogue actually holds, so a
            // narrowing to plain `.read` would be caught.
            expect(keys).toContain('person.read');
            expect(keys).toContain('session.read_own');
            expect(keys).toContain('availability.read_any');
            expect(keys).toContain('solver.snapshot.read');
        });

        it('leaves out page gates and exports', () => {
            const keys = presetKeys(preset('readOnly'));

            expect(keys).not.toContain('dashboard.view');
            expect(keys).not.toContain('person.export');
            expect(keys).not.toContain('tenant.export');
        });

        it('covers the read of every managed entity', () => {
            const keys = new Set(presetKeys(preset('readOnly'))) as ReadonlySet<string>;

            for (const prefix of CRUD_PREFIXES) {
                expect(keys.has(`${ prefix }.read`), prefix).toBe(true);
            }
        });
    });

    describe('import / data entry', () => {
        it('wants read, create and update on the managed entities only', () => {
            for (const key of presetKeys(preset('dataEntry'))) {
                expect(CRUD_PREFIXES.has(prefixOf(key)), key).toBe(true);
                expect(['read', 'create', 'update'], key).toContain(actionOf(key));
            }
        });

        it('deletes nothing and places nothing', () => {
            const keys = presetKeys(preset('dataEntry'));

            expect(keys.filter((key) => actionOf(key) === 'delete')).toEqual([]);
            expect(keys).not.toContain('session.create');
            expect(keys).not.toContain('offering_plan.apply');
            // Named because folding "every read-shaped key" into this preset
            // would quietly add the whole SolverInput download to it.
            expect(keys).not.toContain('solver.snapshot.read');
        });

        it('reaches every managed entity it can write', () => {
            const keys = new Set(presetKeys(preset('dataEntry'))) as ReadonlySet<string>;

            for (const prefix of CRUD_PREFIXES) {
                expect(keys.has(`${ prefix }.create`), prefix).toBe(true);
                expect(keys.has(`${ prefix }.update`), prefix).toBe(true);
            }
        });
    });

    describe('schedule automation', () => {
        it('takes the solver families whole and only placement verbs on session', () => {
            const keys = presetKeys(preset('scheduleAutomation'));

            expect(keys).toContain('generation.read');
            expect(keys).toContain('generation.apply');
            expect(keys).toContain('solver.trigger');
            expect(keys).toContain('violation.read');
            expect(keys).toContain('session.read');
            expect(keys).toContain('session.move');
            expect(keys).toContain('session.swap');
            expect(keys).toContain('session.lock');

            expect(keys).not.toContain('session.create');
            expect(keys).not.toContain('session.delete');
            expect(keys).not.toContain('session.bank');
        });

        /*
         * `exam.request_own` and `exam.review` carry `category: 'session'` in
         * the catalogue, so matching by CATEGORY rather than by prefix would
         * hand a solver script the authority to record an exam for anybody.
         * This is the trap the predicate is written to avoid, so it is pinned.
         */
        it('does not follow the session CATEGORY into the exam keys', () => {
            const keys = presetKeys(preset('scheduleAutomation'));

            expect(keys).not.toContain('exam.request_own');
            expect(keys).not.toContain('exam.review');
        });
    });

    describe('export / reporting', () => {
        it('wants reads plus the exports and calendar links', () => {
            const keys = presetKeys(preset('reporting'));

            expect(keys).toContain('person.export');
            expect(keys).toContain('tenant.export');
            expect(keys).toContain('ics_link.generate');
            expect(keys).toContain('ics_link.generate_own');
            expect(keys).toContain('session.read');
        });

        it('writes nothing else', () => {
            for (const key of presetKeys(preset('reporting'))) {
                const action = actionOf(key);

                expect(
                    /^read(_|$)/.test(action) || action === 'export' || prefixOf(key) === 'ics_link',
                    key,
                ).toBe(true);
            }
        });
    });

    /*
     * THE DELEGATION RULE, in the one function the UI acts on: a token is a
     * Person's own authority narrowed, never a new grant, so a preset may only
     * ever select keys the caller already holds. The server refuses anything
     * wider, which makes a checked box outside `held` a lie in the UI rather
     * than a security hole, and a lie is still the bug.
     */
    describe('resolvePreset', () => {
        it('never grants outside the held set', () => {
            const held = new Set(['person.read', 'room.read', 'person.create']);

            for (const entry of API_TOKEN_PRESETS) {
                for (const key of resolvePreset(entry, held).granted) {
                    expect(held.has(key), `${ entry.id }: ${ key }`).toBe(true);
                }
            }
        });

        it('partitions what the preset wants into granted and missing', () => {
            const entry = preset('readOnly');
            const wanted = presetKeys(entry);
            const held = new Set<string>(['person.read']);
            const { granted, missing } = resolvePreset(entry, held);

            expect(granted).toEqual(['person.read']);
            expect(missing).toContain('room.read');
            expect(granted.length + missing.length).toBe(wanted.length);
            expect(missing).not.toContain('person.read');
        });

        it('reports a shortfall of nothing when the caller holds everything', () => {
            const held = new Set<string>(PERMISSION_KEYS);

            for (const entry of API_TOKEN_PRESETS) {
                const { granted, missing } = resolvePreset(entry, held);

                expect(missing, entry.id).toEqual([]);
                expect(granted.length, entry.id).toBe(presetKeys(entry).length);
            }
        });

        /*
         * A caller who holds none of a preset's keys is a THIRD state, not a
         * quiet success: `granted` empty with `missing` non-empty is what the
         * panel reports as "you hold none of these", rather than leaving a
         * button that appears to have done nothing.
         */
        it('distinguishes holding none of a preset from satisfying it', () => {
            const { granted, missing } = resolvePreset(preset('readOnly'), new Set<string>());

            expect(granted).toEqual([]);
            expect(missing.length).toBeGreaterThan(0);
        });
    });
});
