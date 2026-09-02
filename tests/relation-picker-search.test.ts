import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';
import { manageEntities, personOptionLabel, relationOptionsUrl } from '../app/utils/manageRegistry';
import type { RelationDef } from '../app/utils/manageRegistry';
import { RESOURCES } from '../server/utils/resources';

/**
 * The searchable relation picker, over HTTP and across the two files that have
 * to agree about it.
 *
 * WHY IT CALLS THE ROUTE. `/api/[resource]` switches response shape on `limit`:
 * no `limit` gives a bare array, `limit` gives `{ rows, total }`, and the
 * picker uses `limit`, so it reads `.rows`. `request<T>()` is an unchecked
 * assertion about what the server sends, so getting that backwards typechecks
 * clean and renders an empty result list: "no matches" for a search that
 * actually found people. Three bugs in one hour came from exactly this, and
 * only calling the route catches it.
 *
 * The `ids` half is new here and carries the sharper hazard. It exists so a
 * searchable picker can still label the rows already assigned without loading
 * the tenant's whole directory, and an `ids` parameter that degraded to
 * "unfiltered" when empty would answer a request for nothing with everything.
 */
const ids = { a: '', b: '', viewer: '', multiA: '', multiB: '' };

let cookieA = '';
let cookieB = '';

beforeAll(async () => {
    const seeded = await seed();

    ids.a = seeded.personA;
    ids.b = seeded.personB;
    ids.viewer = seeded.personViewerA;
    ids.multiA = seeded.personMultiA;
    ids.multiB = seeded.personMultiB;

    cookieA = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;
    cookieB = (await login(ACCOUNTS.adminB, TEST_PASSWORD)).cookie;
});

afterAll(teardown);

describe('searching persons', () => {
    it('answers the PAGED envelope, not a bare array', async () => {
        const res = await api<{ rows: unknown[]; total: number }>(
            '/api/persons?q=a&limit=20',
            { cookie: cookieA },
        );

        expect(res.status).toBe(200);
        // Both halves asserted. `rows` alone would pass for a bare array in a
        // wrapper; `total` is what the picker needs to say "20 of 143".
        expect(Array.isArray(res.body.rows)).toBe(true);
        expect(typeof res.body.total).toBe('number');
    });

    it('matches a given name, a family name and an email, case-insensitively', async () => {
        for (const query of ['ADA', 'alph', 'ada@a']) {
            const res = await api<{ rows: { id: string }[] }>(
                `/api/persons?q=${encodeURIComponent(query)}&limit=20`,
                { cookie: cookieA },
            );

            expect(res.status, query).toBe(200);
            expect(res.body.rows.map((row) => row.id), query).toContain(ids.a);
        }
    });

    it('never reaches another tenant, even on an exact name match', async () => {
        // Both tenants seed a "Mel Multi". A search that leaked would return
        // two rows and look like a perfectly ordinary duplicate.
        const res = await api<{ rows: { id: string }[]; total: number }>(
            '/api/persons?q=Multi&limit=20',
            { cookie: cookieA },
        );

        expect(res.status).toBe(200);
        expect(res.body.rows.map((row) => row.id)).toEqual([ids.multiA]);
        expect(res.body.total).toBe(1);
    });

});

describe('resolving rows by id', () => {
    it('returns exactly the named rows, as a bare array', async () => {
        const res = await api<{ id: string }[]>(
            `/api/persons?ids=${ids.a},${ids.viewer}`,
            { cookie: cookieA },
        );

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.map((row) => row.id).sort()).toEqual([ids.a, ids.viewer].sort());
    });

    it('REJECTS an empty list instead of returning everything', async () => {
        const res = await api('/api/persons?ids=', { cookie: cookieA });

        // The whole reason the parameter is validated rather than defaulted.
        // `[].join(',')` is one line away in any caller, and the alternative
        // reading of this request is a tenant-wide dump.
        expect(res.status).toBe(400);
    });

    it('cannot name a row in another tenant', async () => {
        const res = await api<{ id: string }[]>(
            `/api/persons?ids=${ids.a},${ids.multiB}`,
            { cookie: cookieA },
        );

        expect(res.status).toBe(200);
        // The foreign id is dropped, not an error and not honoured: ownership
        // is AND-ed with the id filter, so naming an id is a narrowing.
        expect(res.body.map((row) => row.id)).toEqual([ids.a]);
    });

    it('is bounded, so the parameter cannot become an unpaged list', async () => {
        const tooMany = Array.from({ length: 201 }, (_, index) => `id-${index}`).join(',');
        const res = await api(`/api/persons?ids=${tooMany}`, { cookie: cookieA });

        expect(res.status).toBe(400);
    });

    it('still respects the caller’s own tenant when the other one asks', async () => {
        const res = await api<{ id: string }[]>(
            `/api/persons?ids=${ids.b}`,
            { cookie: cookieB },
        );

        expect(res.status).toBe(200);
        expect(res.body.map((row) => row.id)).toEqual([ids.b]);
    });
});

describe('the declaration and the route agree', () => {
    // `(key) => key`: this block checks `searchable`/`indentTree` and the
    // resource each relation names, never a word of copy, which is the case
    // `i18n/CONVENTIONS.md` says to stub the translator for.
    const relations = manageEntities((key) => key).flatMap((entity) => (entity.relations ?? []).map(
        (def) => ({ entity: entity.key, def }),
    ));

    it('has at least one searchable relation, so the checks below are not vacuous', () => {
        expect(relations.filter(({ def }) => def.searchable).length).toBeGreaterThan(0);
    });

    /**
     * The route answers 400 for a `q=` against a resource declaring no
     * `searchFields`, rather than ignoring the parameter and returning
     * everything. That branch is NOT exercised over HTTP here because no
     * resource currently omits them (all twelve declare some), so there is
     * nothing to point it at without inventing a fake resource.
     *
     * What actually protects the picker is the check below: it is the searchable
     * RELATION, not the resource, that turns a missing declaration into a list
     * that stays empty on every keystroke.
     */
    it('never declares a searchable relation over a resource with no search fields', () => {
        for (const { entity, def } of relations.filter((r) => r.def.searchable)) {
            const config = RESOURCES[def.resource];

            // Without this the picker's every keystroke answers 400 and the
            // list stays empty, which looks exactly like "nobody matches".
            expect(config, `${entity}/${def.key} -> ${def.resource}`).toBeDefined();
            expect(
                config!.searchFields?.length ?? 0,
                `${entity}/${def.key} searches ${def.resource}, which declares no searchFields`,
            ).toBeGreaterThan(0);
        }
    });

    it('never combines searchable with indentTree', () => {
        for (const { entity, def } of relations) {
            // A tree needs every ancestor of a match to draw the match at all,
            // and a `q=` page returns matches only. The picker would render
            // orphans with no hint that their parents exist.
            expect(
                Boolean(def.searchable && def.indentTree),
                `${entity}/${def.key} declares both searchable and indentTree`,
            ).toBe(false);
        }
    });
});

describe('personOptionLabel', () => {
    // One label function, two row shapes: `/api/persons` sends the name in
    // parts, the schedule page's directory pre-composes it. A searchable picker
    // shows both in one list.
    it('reads the composed name when the directory supplies it', () => {
        expect(personOptionLabel({ id: 'x', name: 'Ada Alpha' })).toBe('Ada Alpha');
    });

    it('composes the parts when the API supplies them', () => {
        expect(personOptionLabel({ id: 'x', givenName: 'Ada', familyName: 'Alpha' })).toBe('Ada Alpha');
    });

    it('falls back to the id rather than rendering an empty cell', () => {
        expect(personOptionLabel({ id: 'person-1' })).toBe('person-1');
        expect(personOptionLabel({ id: 'person-1', name: '   ' })).toBe('person-1');
    });
});

describe('what the option wave fetches', () => {
    /**
     * The half of this feature that removes the cost, and the half no rendered
     * page can see: a searchable picker looks identical whether its parent
     * loaded three rows or three thousand.
     */
    const searchable: RelationDef = {
        key: 'lecturers',
        label: 'Who leads it',
        resource: 'persons',
        valueKey: 'personId',
        searchable: true,
        optionLabel: personOptionLabel,
    };

    const plain: RelationDef = {
        key: 'equipment',
        label: 'Equipment',
        resource: 'equipment',
        valueKey: 'equipmentId',
        optionLabel: (row) => String(row.name),
    };

    it('asks for the ASSIGNED rows only, never the full list', () => {
        expect(relationOptionsUrl(searchable, ['p1', 'p2'], '/api/persons'))
            .toBe('/api/persons?ids=p1,p2');
    });

    it('makes no request when nothing is assigned', () => {
        // `null`, not `/api/persons`: the distinction between "nothing to
        // label" and "load the institution".
        expect(relationOptionsUrl(searchable, [], '/api/persons')).toBeNull();
    });

    it('de-duplicates, so a repeated id cannot inflate the URL', () => {
        expect(relationOptionsUrl(searchable, ['p1', 'p1', 'p2'], '/api/persons'))
            .toBe('/api/persons?ids=p1,p2');
    });

    it('drops empty ids rather than sending a trailing comma', () => {
        // A join over a row whose valueKey was absent produces `String(undefined)`
        // upstream; an empty segment here would make the whole request a 400.
        expect(relationOptionsUrl(searchable, ['p1', ''], '/api/persons'))
            .toBe('/api/persons?ids=p1');
    });

    it('leaves a non-searchable relation on the full list it always used', () => {
        expect(relationOptionsUrl(plain, ['e1'], '/api/equipment?termId=t1'))
            .toBe('/api/equipment?termId=t1');
    });
});
