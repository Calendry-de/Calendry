import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';
import { assembleSolverInput } from '../server/utils/solverInput';
import { manageEntities } from '../app/utils/manageRegistry';
import { englishT } from './helpers/manageMessages';

/**
 * `Room.footprintTags` (issue #122): several Room identities sharing one
 * physical space (movable walls), sent as the proto's `footprint_tags`.
 *
 * Pinned at three boundaries: the wire carries the stored tags verbatim, the
 * generic CRUD route trims and deduplicates them and refuses them on a virtual
 * Room with a field-level 422 (the DB CHECK is the backstop), and the Room form
 * exposes them through the new generic `tags` field type.
 */
let f: Fixtures;
let adminCookie = '';

beforeAll(async () => {
    f = await seed();
    adminCookie = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;
});

afterEach(async () => {
    await ownerDb.room.update({ where: { id: f.roomPrivateA }, data: { footprintTags: [], isVirtual: false } });
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

const assemble = () => ownerDb.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL calendry.tenant_id = '${f.tenantA}'`);

    return assembleSolverInput(tx as never, { tenantId: f.tenantA, termId: f.termA, now: new Date() });
});

const patch = (body: unknown) => api<Record<string, unknown>>(`/api/rooms/${f.roomPrivateA}`, {
    method: 'PATCH', cookie: adminCookie, body: JSON.stringify(body),
});

describe('the wire', () => {
    it('sends no tags by default: the proto\'s documented "no footprint blocking"', async () => {
        const { input } = await assemble();

        expect(input.rooms.find((r) => r.id === f.roomPrivateA)!.footprintTags).toEqual([]);
    });

    it('sends the stored tags verbatim', async () => {
        await ownerDb.room.update({ where: { id: f.roomPrivateA }, data: { footprintTags: ['audimax', 'wall-1'] } });

        const { input } = await assemble();

        expect(input.rooms.find((r) => r.id === f.roomPrivateA)!.footprintTags).toEqual(['audimax', 'wall-1']);
    });
});

describe('the write boundary', () => {
    it('trims and deduplicates, so "Audimax" and "Audimax " cannot be two footprints', async () => {
        const res = await patch({ footprintTags: [' audimax', 'audimax ', 'wall-1'] });

        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.footprintTags).toEqual(['audimax', 'wall-1']);
    });

    it('refuses a footprint on a VIRTUAL room with a field, before the CHECK would', async () => {
        await ownerDb.room.update({ where: { id: f.roomPrivateA }, data: { isVirtual: true } });

        const res = await patch({ footprintTags: ['audimax'] });

        expect(res.status).toBe(422);
        expect(JSON.stringify(res.body)).toContain('footprintTags');
    });

    it('refuses making a tagged room virtual, the other half of the same pair', async () => {
        await ownerDb.room.update({ where: { id: f.roomPrivateA }, data: { footprintTags: ['audimax'] } });

        const res = await patch({ isVirtual: true });

        expect(res.status).toBe(422);
    });

    it('the database CHECK is the backstop for a write that bypasses the route', async () => {
        await expect(ownerDb.room.update({
            where: { id: f.roomPrivateA },
            data: { isVirtual: true, footprintTags: ['audimax'] },
        })).rejects.toThrow();
    });

    it('clears back to none on an empty array', async () => {
        await ownerDb.room.update({ where: { id: f.roomPrivateA }, data: { footprintTags: ['audimax'] } });

        const res = await patch({ footprintTags: [] });

        expect(res.status).toBe(200);
        expect(res.body.footprintTags).toEqual([]);
    });
});

describe('the form', () => {
    it('exposes the tags through the generic tags field, with help naming the movable-wall case', () => {
        const field = manageEntities(englishT)
            .find((entity) => entity.key === 'rooms')!
            .fields.find((field) => field.key === 'footprintTags');

        expect(field).toBeDefined();
        expect(field!.type).toBe('tags');
        expect(field!.help).toContain('movable walls');
    });
});
