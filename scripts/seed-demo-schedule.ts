/**
 * Builds a demo institution for one tenant: a grid, a vocabulary, a group tree,
 * six terms, ten modules and a first week of placements.
 *
 * SEPARATE FROM SEEDING, AND THE LINE IS NOT ARBITRARY.
 *
 *   `prisma/seed.ts`      — data the system is INCORRECT without. The permission
 *                           catalogue, mirrored from code. Runs everywhere,
 *                           production included.
 *   `provision:tenant`    — one tenant's own bootstrap: its access roles, its
 *                           first administrator, its baseline constraint rows.
 *   this script           — DEMO CONTENT. Nothing here is required by anything;
 *                           a real institution names its own session kinds,
 *                           draws its own grid and enters its own modules.
 *
 * Offerings in particular can only ever live here. There is no default Offering
 * and there cannot be one — an Offering is the institution's own curriculum, so
 * seeding one would be inventing a course nobody teaches.
 *
 *   bun run seed:demo -- --tenant test [--reset]
 *
 * The content comes from two real documents rather than being invented; see
 * `scripts/lib/demoData.ts` for what was read out of them and why it matters.
 *
 * Runs on the OWNER role because it disables append-only triggers on --reset.
 * Everything it writes is still tenant-scoped.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { describeTarget, resolveOwnerDatabaseUrl } from './lib/ownerDatabaseUrl';
import {
    BREAKS, GRID, GROUPS, GROUP_TERMS, KINDS, LECTURERS, MODULES, ROOMS, TERMS,
} from './lib/demoData';

function arg(name: string): string | undefined {
    const index = process.argv.indexOf(`--${name}`);

    return index === -1 ? undefined : process.argv[index + 1];
}

const tenantSlug = arg('tenant') ?? 'test';
const reset = process.argv.includes('--reset');

async function main() {
    const connectionString = resolveOwnerDatabaseUrl();
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

    console.log(`Seeding demo institution on ${describeTarget(connectionString)} for tenant '${tenantSlug}'...`);

    try {
        const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });

        if (!tenant) {
            throw new Error(`No tenant with slug '${tenantSlug}'. Run provision:tenant first.`);
        }

        const t = tenant.id;

        if (reset) {
            // Sessions cascade from Offering; events and generations carry
            // append-only guards that only the owner can lift.
            await prisma.$executeRawUnsafe('ALTER TABLE session_event DISABLE TRIGGER session_event_append_only');
            await prisma.$executeRawUnsafe('ALTER TABLE generation DISABLE TRIGGER generation_no_delete');
            await prisma.$executeRawUnsafe(`DELETE FROM session_event WHERE tenant_id = '${t}'`);
            await prisma.$executeRawUnsafe(`DELETE FROM "session" WHERE tenant_id = '${t}'`);
            await prisma.$executeRawUnsafe(`DELETE FROM generation WHERE tenant_id = '${t}'`);
            await prisma.$executeRawUnsafe(`DELETE FROM offering WHERE tenant_id = '${t}'`);
            await prisma.$executeRawUnsafe('ALTER TABLE session_event ENABLE TRIGGER session_event_append_only');
            await prisma.$executeRawUnsafe('ALTER TABLE generation ENABLE TRIGGER generation_no_delete');
            console.log('  cleared existing sessions, offerings and generations');
        }

        // --- vocabulary ------------------------------------------------------
        const kindByKey = new Map<string, string>();

        for (const k of KINDS) {
            const row = await prisma.sessionKind.upsert({
                where: { tenantId_key: { tenantId: t, key: k.key } },
                create: { tenantId: t, ...k },
                // Updated, not left alone: the `type` column is newer than some
                // demo databases, and a stale TEACHING on the exam kinds would
                // leave `exam_spacing_*` deriving an empty scope and skipping.
                update: { type: k.type, name: k.name, color: k.color, requiresGroup: k.requiresGroup },
            });

            kindByKey.set(k.key, row.id);
        }

        // --- grid ------------------------------------------------------------
        const grid = await prisma.timeGrid.upsert({
            where: { tenantId_name: { tenantId: t, name: GRID.name } },
            create: { tenantId: t, ...GRID, isDefault: true },
            update: { ...GRID, isDefault: true },
        });

        await prisma.timeGridBreak.deleteMany({ where: { timeGridId: grid.id } });
        await prisma.timeGridBreak.createMany({
            data: BREAKS.map((b) => ({ tenantId: t, timeGridId: grid.id, ...b })),
        });

        // --- terms -----------------------------------------------------------
        const termByKey = new Map<string, string>();

        for (const term of TERMS) {
            const row = await prisma.term.upsert({
                where: { tenantId_name: { tenantId: t, name: term.name } },
                create: {
                    tenantId: t, name: term.name, timeGridId: grid.id,
                    startDate: new Date(term.start), endDate: new Date(term.end),
                },
                update: { timeGridId: grid.id, startDate: new Date(term.start), endDate: new Date(term.end) },
            });

            termByKey.set(term.key, row.id);

            await prisma.calendarPeriod.upsert({
                where: { id: `${t}-exams-${term.key}` },
                create: {
                    id: `${t}-exams-${term.key}`, tenantId: t, termId: row.id, kind: 'EXAM',
                    name: 'Prüfungszeitraum',
                    startDate: new Date(term.exams[0]!), endDate: new Date(term.exams[1]!),
                },
                update: {},
            });
        }

        const termId = termByKey.get('s1')!;

        // --- rooms -----------------------------------------------------------
        const rooms = [];

        for (const room of ROOMS) {
            rooms.push(await prisma.room.upsert({
                where: { id: `${t}-room-${room.code}` },
                create: { id: `${t}-room-${room.code}`, tenantId: t, ...room },
                update: { ...room },
            }));
        }

        // --- people ----------------------------------------------------------
        const lecturerRole = await prisma.role.findFirst({ where: { tenantId: t, key: 'lecturer' } });
        const personByKey = new Map<string, string>();

        for (const l of LECTURERS) {
            const email = `${l.key}@demo.local`;
            const person = await prisma.person.upsert({
                where: { tenantId_email: { tenantId: t, email } },
                create: { tenantId: t, givenName: l.givenName, familyName: l.familyName, email },
                update: {},
            });

            personByKey.set(l.key, person.id);

            if (lecturerRole) {
                await prisma.personRole.upsert({
                    where: { personId_roleId: { personId: person.id, roleId: lecturerRole.id } },
                    create: { tenantId: t, personId: person.id, roleId: lecturerRole.id },
                    update: {},
                });
            }
        }

        // --- groups ----------------------------------------------------------
        // Written parent-first, which the declaration order guarantees: a child
        // naming a parent that does not exist yet is an FK error, and FK checks
        // do not consult RLS, so it would fail loudly rather than silently.
        const groupByKey = new Map<string, string>();

        for (const g of GROUPS) {
            const row = await prisma.group.upsert({
                where: { id: `${t}-group-${g.key}` },
                create: {
                    id: `${t}-group-${g.key}`, tenantId: t, name: g.name,
                    expectedSize: g.expectedSize,
                    parentGroupId: g.parent ? groupByKey.get(g.parent)! : null,
                },
                update: { name: g.name, expectedSize: g.expectedSize },
            });

            groupByKey.set(g.key, row.id);
        }

        await prisma.groupTerm.deleteMany({ where: { tenantId: t } });
        await prisma.groupTerm.createMany({
            data: GROUP_TERMS.map((link) => ({
                tenantId: t,
                groupId: groupByKey.get(link.group)!,
                termId: termByKey.get(link.term)!,
            })),
        });

        // --- offerings -------------------------------------------------------
        /*
         * A split module becomes TWO Offerings, one per half-cohort, because an
         * Offering carries one demand: "this many sessions, for these groups".
         * One Offering attended by both halves would let the solver put them in
         * the same room at the same time, which is the opposite of a split.
         */
        let offeringCount = 0;
        const offeringIds: string[] = [];

        for (const m of MODULES) {
            const halves = m.split
                ? [{ suffix: '-S1', group: 's1', label: ' (S1)' }, { suffix: '-S2', group: 's2', label: ' (S2)' }]
                : [{ suffix: '', group: 'semester1', label: '' }];

            for (const half of halves) {
                const id = `${t}-offering-${m.code}${half.suffix}`;
                /*
                 * Each half gets the FULL contact hours, not a share of them —
                 * the hours are what one student sits through, and splitting the
                 * cohort doubles the teaching rather than dividing it. Halving
                 * here would quietly under-schedule every split module.
                 */
                const frequency = Math.max(1, Math.round(m.hours / 2));

                await prisma.offering.upsert({
                    where: { id },
                    create: {
                        id, tenantId: t, termId, kindId: kindByKey.get(m.kind)!,
                        code: `${m.code}${half.suffix}`, title: `${m.title}${half.label}`,
                        frequency,
                        /*
                         * ONE block, which IS 90 minutes here — the slot a
                         * module fills in the source timetable. It was 2 while
                         * a block was 45.
                         */
                        durationBlocks: 1,
                        requiredRoleId: lecturerRole?.id ?? null,
                    },
                    update: { frequency, durationBlocks: 1 },
                });

                await prisma.offeringGroup.deleteMany({ where: { offeringId: id } });
                await prisma.offeringGroup.create({
                    data: { tenantId: t, offeringId: id, groupId: groupByKey.get(half.group)! },
                });

                await prisma.offeringLecturer.deleteMany({ where: { offeringId: id } });
                await prisma.offeringLecturer.create({
                    data: {
                        tenantId: t, offeringId: id,
                        personId: personByKey.get(m.lecturer)!,
                        roleId: lecturerRole?.id ?? null,
                    },
                });

                offeringIds.push(id);
                offeringCount++;
            }
        }

        // --- a baseline generation -------------------------------------------
        /*
         * A handful of placements, not a full timetable. Producing the full one
         * is the SOLVER's job, and pre-placing it here would hide whether the
         * solver can — the demo exists to be run against, not to look finished.
         *
         * Placed at block 1, 3, 5 … deliberately: those are the positions a
         * 90-minute session occupies without spanning a break, so the starting
         * point is legal and any break-spanning session in the UI came from an
         * edit or a solve rather than from here.
         */
        const generation = await prisma.generation.upsert({
            where: { tenantId_version: { tenantId: t, version: 1 } },
            create: { tenantId: t, version: 1, source: 'MANUAL_BASELINE', status: 'APPLIED', isCurrent: true },
            update: {},
        });

        /*
         * EVERY block is a legal start now, because every baseline session is
         * one block long and a one-block session cannot span a break. The list
         * existed when a session was two 45-minute blocks and half the
         * positions straddled a gap.
         */
        const legalStarts = Array.from({ length: GRID.blocksPerDay }, (_, i) => i);
        let placed = 0;

        for (const [index, offeringId] of offeringIds.entries()) {
            const offering = await prisma.offering.findUniqueOrThrow({
                where: { id: offeringId },
                include: { groups: true, lecturers: true },
            });
            const id = `${t}-session-${index}`;

            await prisma.session.upsert({
                where: { id },
                create: {
                    id, tenantId: t, offeringId, termId,
                    kindId: offering.kindId, timeGridId: grid.id,
                    termWeek: 1,
                    dayOfWeek: GRID.activeDays[index % GRID.activeDays.length]!,
                    blockIndex: legalStarts[index % legalStarts.length]!,
                    durationBlocks: 1,
                    generationId: generation.id,
                    isLocked: index === 0,
                },
                update: {},
            });

            const room = rooms[index % (rooms.length - 1)]!;

            await prisma.sessionRoom.upsert({
                where: { sessionId_roomId: { sessionId: id, roomId: room.id } },
                create: { tenantId: t, sessionId: id, roomId: room.id },
                update: {},
            });

            for (const link of offering.groups) {
                await prisma.sessionGroup.upsert({
                    where: { sessionId_groupId: { sessionId: id, groupId: link.groupId } },
                    create: { tenantId: t, sessionId: id, groupId: link.groupId },
                    update: {},
                });
            }

            for (const link of offering.lecturers) {
                await prisma.sessionPerson.upsert({
                    where: { sessionId_personId: { sessionId: id, personId: link.personId } },
                    create: {
                        tenantId: t, sessionId: id, personId: link.personId,
                        roleId: lecturerRole?.id ?? null,
                    },
                    update: {},
                });
            }

            placed++;
        }

        console.log(`  ${KINDS.length} session kinds (${KINDS.filter((k) => k.type === 'EXAM').length} exam-typed)`);
        console.log(`  grid '${grid.name}': ${GRID.blocksPerDay} x ${GRID.blockLengthMinutes}min, ${BREAKS.length} breaks, ${GRID.activeDays.length} days`);
        console.log(`  ${TERMS.length} terms, ${GROUPS.length} groups, ${GROUP_TERMS.length} group-term scopes`);
        console.log(`  ${LECTURERS.length} lecturers, ${rooms.length} rooms`);
        console.log(`  ${offeringCount} offerings in '${TERMS[0]!.name}', each with a group and a lecturer`);
        console.log(`  ${placed} baseline sessions in week 1 — the rest is the solver's job`);
        console.log('Done.');
    } catch (error) {
        console.error(`\nFailed: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

await main();
