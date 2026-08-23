import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { login } from './helpers/client';

/**
 * A structured field value must never render as `[object Object]`.
 *
 * FOUND IN PRODUCTION-SHAPED USE, NOT BY REVIEW. `time_grid.breaks` is an array
 * declared `type: 'text'` in the manage registry, and `ManageField`'s read-only
 * branch ended in `String(value)`. A viewer opening a TimeGrid saw
 * "[object Object]" under the label "Named breaks"; an admin saw an empty text
 * input under the same label, which would have replaced the whole array with a
 * string on the first keystroke.
 *
 * It was invisible to anyone with `time_grid.update` for months, because the
 * bespoke editor supplies the real control on the editable path — so the only
 * way to catch it is to render the page AS A VIEWER, which is what this does.
 *
 * The assertion is deliberately about the CHARACTER of the output rather than
 * about `breaks` specifically: the fix is a guard in ManageField, so any future
 * registry field holding structured data is covered by this same test.
 */
const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:8080';

const GRID = 'test-grid-a';

let viewerCookie: string;
let adminCookie: string;

async function page(path: string, cookie: string): Promise<string> {
    const res = await fetch(`${BASE}${path}`, { headers: { cookie } });

    expect(res.status).toBe(200);

    return res.text();
}

beforeAll(async () => {
    await seed();

    // A break makes `breaks` a NON-EMPTY array. With no rows the field is `[]`,
    // which stringifies to "" and hides the defect entirely — the reason this
    // needs a fixture rather than the seed's bare grid.
    await ownerDb.timeGridBreak.create({
        data: {
            tenantId: 'test-tenant-a',
            timeGridId: GRID,
            afterBlockIndex: 1,
            durationMinutes: 45,
            label: 'Lunch',
            dayOfWeek: null,
        },
    });

    /**
     * The shared viewer holds exactly `session.read` — pinned by
     * `auth-permissions.test.ts`, which asserts that set with `toEqual`. So the
     * grant needed to reach a TimeGrid page is made HERE rather than in the
     * shared seed, where it would break that assertion.
     *
     * Safe because `fileParallelism: false` (vitest.config.ts): suites run
     * serially and each one's `beforeAll` re-seeds, so this row never outlives
     * this file.
     */
    await ownerDb.accessRolePermission.create({
        data: {
            accessRoleId: (await ownerDb.accessRole.findFirstOrThrow({
                where: { tenantId: 'test-tenant-a', key: 'viewer' },
                select: { id: true },
            })).id,
            permissionKey: 'time_grid.read',
            tenantId: 'test-tenant-a',
        },
    });

    ({ cookie: viewerCookie } = await login(ACCOUNTS.viewerA, TEST_PASSWORD));
    ({ cookie: adminCookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD));
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

describe('a TimeGrid with named breaks', () => {
    it('renders no [object Object] for a viewer, and still renders the page', async () => {
        const html = await page(`/manage/time-grids/${GRID}`, viewerCookie);

        // Both halves matter: "absent" proves nothing if the page failed to
        // render, which is the trap this codebase has already documented.
        expect(html).toContain('Named breaks');
        expect(html).not.toContain('[object Object]');
    });

    it('renders no [object Object] for an admin either', async () => {
        const html = await page(`/manage/time-grids/${GRID}`, adminCookie);

        expect(html).toContain('Named breaks');
        expect(html).not.toContain('[object Object]');
    });

    it('shows the break exactly once — the section, not a phantom generic field', async () => {
        const html = await page(`/manage/time-grids/${GRID}`, viewerCookie);

        // Two labels meant the array was ALSO being handed to the generic
        // ManageField, which is the whole defect.
        expect((html.match(/>Named breaks/g) ?? [])).toHaveLength(1);
    });

    it('still shows the break in the day preview, so the fix removed noise and not signal', async () => {
        const html = await page(`/manage/time-grids/${GRID}`, viewerCookie);

        expect(html).toContain('Lunch');
    });
});
