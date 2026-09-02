/**
 * Builds a demo institution for one tenant: a grid, a vocabulary, a group tree,
 * six terms, every module of the six-semester curriculum (as reusable
 * OfferingTemplates bundled into per-term curriculum plans, applied to their
 * cohorts), and a first week of placements in each term.
 *
 * SEPARATE FROM SEEDING, AND THE LINE IS NOT ARBITRARY.
 *
 *   `prisma/seed.ts`      : data the system is INCORRECT without. The permission
 *                           catalogue, mirrored from code. Runs everywhere,
 *                           production included.
 *   `provision:tenant`    : one tenant's own bootstrap: its access roles, its
 *                           first administrator, its baseline constraint rows.
 *   this script           : DEMO CONTENT. Nothing here is required by anything;
 *                           a real institution names its own session kinds,
 *                           draws its own grid and enters its own modules.
 *
 * Offerings in particular can only ever live here. There is no default Offering
 * and there cannot be one: an Offering is the institution's own curriculum, so
 * seeding one would be inventing a course nobody teaches. Templates and plans
 * are the SAME story one level up: this script's own opinion of how the
 * curriculum is shaped, not something any tenant is owed.
 *
 *   bun run seed:demo -- --tenant test [--reset]
 *
 * The content comes from two real documents rather than being invented; see
 * `scripts/lib/demoData.ts` for what was read out of them and why it matters.
 *
 * Runs on the OWNER role because it disables append-only triggers on --reset.
 * Everything it writes is still tenant-scoped.
 */
import { describeTarget, resolveOwnerDatabaseUrl } from './lib/ownerDatabaseUrl';
import { arg, createOwnerPrisma } from './lib/cli';
import { LECTURER_ROLE_KEY } from '../shared/roles';
import { applyOfferingPlanItems } from '../server/utils/offeringPlans';
import {
    BREAKS, GRID, GROUPS, GROUP_SOURCES, GROUP_TERMS, KINDS, LECTURERS, MODULES, ROOMS, TERMS,
} from './lib/demoData';

const tenantSlug = arg('tenant') ?? 'test';
const reset = process.argv.includes('--reset');

async function main() {
    const connectionString = resolveOwnerDatabaseUrl();
    const prisma = createOwnerPrisma();

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

            /*
             * GROUPS TOO, deliberately, and not with a single DELETE: the
             * self-referential `parentGroupId` FK is `onDelete: Restrict`, so a
             * row survives as long as anything still points at it as a parent.
             * Deleting current leaves repeatedly clears the whole tenant's tree
             * regardless of how many past shapes `GROUPS` has had: without
             * this, a group key this script stops declaring (as `semester4-st`
             * was, once) outlives the code that created it, orphaned with no
             * Offering and no way for a later run to reach it by id.
             */
            for (let round = 0; round < 10; round++) {
                const { count } = await prisma.group.deleteMany({
                    where: { tenantId: t, children: { none: {} } },
                });

                if (count === 0) {
                    break;
                }
            }
            console.log('  cleared existing groups (including any from an earlier shape)');
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
        const lecturerRole = await prisma.role.findFirst({ where: { tenantId: t, key: LECTURER_ROLE_KEY } });
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

        // Systemtechnik/Management are "Built from other groups"; see GROUPS'
        // own comment. `group_source`'s PK is `(groupId, sourceGroupId)`, so this
        // is idempotent without a delete-then-create.
        for (const link of GROUP_SOURCES) {
            await prisma.groupSource.upsert({
                where: {
                    groupId_sourceGroupId: {
                        groupId: groupByKey.get(link.group)!,
                        sourceGroupId: groupByKey.get(link.source)!,
                    },
                },
                create: {
                    tenantId: t,
                    groupId: groupByKey.get(link.group)!,
                    sourceGroupId: groupByKey.get(link.source)!,
                },
                update: {},
            });
        }

        // --- offering templates ------------------------------------------------
        /*
         * ONE OfferingTemplate per module: the reusable shape a curriculum
         * plan bundles, rather than an Offering created directly. Every
         * series still gets the FULL contact hours, not a share of them: the
         * hours are what one student sits through, and a second Group
         * doubles the teaching rather than dividing it.
         */
        const templateByCode = new Map<string, Awaited<ReturnType<typeof prisma.offeringTemplate.upsert>>>();

        for (const m of MODULES) {
            const id = `${t}-offering-template-${m.code}`;
            const frequency = Math.max(1, Math.round(m.hours / 2));

            const template = await prisma.offeringTemplate.upsert({
                where: { id },
                create: {
                    id, tenantId: t, name: `${m.code}: ${m.title}`,
                    title: m.title, kindId: kindByKey.get(m.kind)!, code: m.code,
                    frequency,
                    // ONE block, which IS 90 minutes here: the slot a module
                    // fills in the source timetable. It was 2 while a block
                    // was 45.
                    durationBlocks: 1,
                    requiredRoleId: lecturerRole?.id ?? null,
                },
                update: {
                    name: `${m.code}: ${m.title}`, title: m.title, kindId: kindByKey.get(m.kind)!,
                    frequency, durationBlocks: 1, requiredRoleId: lecturerRole?.id ?? null,
                },
            });

            templateByCode.set(m.code, template);
        }

        // --- curriculum plans ----------------------------------------------
        /*
         * One plan per (term, audience). Most terms have a single plan for
         * the whole cohort (`m.groups` defaulting to `['s1', 's2']`, per
         * `demoData.ts`'s own comment), and Semester 4-6 additionally split
         * into a Systemtechnik and a Management plan for the modules scoped
         * to just one of those tracks. Grouping by `m.groups` rather than
         * hand-declaring the plans keeps this in sync with `MODULES` by
         * construction: a module moved between tracks moves its plan too.
         */
        interface PlanGroup { termKey: string; groupKeys: readonly string[]; moduleCodes: string[] }
        const planGroups = new Map<string, PlanGroup>();

        for (const m of MODULES) {
            const key = `${m.term}:${[...m.groups].sort().join('+')}`;
            const group = planGroups.get(key) ?? { termKey: m.term, groupKeys: m.groups, moduleCodes: [] };

            group.moduleCodes.push(m.code);
            planGroups.set(key, group);
        }

        const termNameByKey = new Map(TERMS.map((term) => [term.key, term.name]));
        const groupNameByKey = new Map(GROUPS.map((g) => [g.key, g.name]));

        let offeringCount = 0;
        const offeringIds: string[] = [];
        const seenOfferingIds = new Set<string>();
        const offeringIdByModuleCode = new Map<string, string>();

        for (const [key, plan] of planGroups) {
            /*
             * The full-cohort plan is just the term's own name; a track plan
             * says so ("Semester 4: Systemtechnik") since the term alone
             * would collide with the cohort plan sharing that term.
             */
            const planName = plan.groupKeys.length === 1
                ? `${termNameByKey.get(plan.termKey)}: ${groupNameByKey.get(plan.groupKeys[0]!)}`
                : termNameByKey.get(plan.termKey)!;

            const planId = `${t}-plan-${key.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;

            await prisma.offeringPlan.upsert({
                where: { id: planId },
                create: { id: planId, tenantId: t, name: planName },
                update: { name: planName },
            });

            // Deterministic ids so re-running without --reset updates rather
            // than duplicates, matching every other upsert in this script.
            await prisma.offeringPlanItem.deleteMany({ where: { planId } });
            await prisma.offeringPlanItem.createMany({
                data: plan.moduleCodes.map((code, position) => ({
                    id: `${planId}-item-${code}`,
                    tenantId: t,
                    planId,
                    templateId: templateByCode.get(code)!.id,
                    position,
                })),
            });

            const items = plan.moduleCodes.map((code) => ({
                templateId: templateByCode.get(code)!.id,
                template: templateByCode.get(code)!,
            }));

            /*
             * APPLIED ONCE PER GROUP IN THE PLAN'S AUDIENCE, through the SAME
             * function `/api/offering-plan-apply` uses: the demo curriculum
             * is built the way a tenant would build it, not a second
             * definition of what applying a plan means. A two-group plan's
             * second apply finds the first apply's Offerings already exist
             * and joins them (TAXONOMY.md § "What attaching several Groups to
             * one Offering MEANS"), so this never creates a `-S1`/`-S2` pair.
             */
            for (const groupKey of plan.groupKeys) {
                const results = await applyOfferingPlanItems(prisma, {
                    tenantId: t,
                    termId: termByKey.get(plan.termKey)!,
                    groupId: groupByKey.get(groupKey)!,
                    items,
                });

                results.forEach((result, index) => {
                    const code = plan.moduleCodes[index]!;

                    offeringIdByModuleCode.set(code, result.id);

                    if (!seenOfferingIds.has(result.id)) {
                        seenOfferingIds.add(result.id);
                        offeringIds.push(result.id);
                        offeringCount++;
                    }
                });
            }
        }

        /*
         * SUCCESSION: "Semester 3" points at "Semester 4" for the SAME
         * audience: the core cohort plan chains to the next core cohort
         * plan, Systemtechnik's to Systemtechnik's, so advancing a Group
         * from the Group page needs no picker. A second pass, not folded
         * into the loop above, because linking a Term's plan to the NEXT
         * Term's needs that next plan to already exist.
         */
        for (const key of planGroups.keys()) {
            const [termKey, audienceKey] = key.split(':') as [string, string];
            const nextTermKey = `s${Number(termKey.slice(1)) + 1}`;
            const nextKey = `${nextTermKey}:${audienceKey}`;

            if (!planGroups.has(nextKey)) {
                continue;
            }

            const planId = `${t}-plan-${key.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
            const nextPlanId = `${t}-plan-${nextKey.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;

            await prisma.offeringPlan.update({ where: { id: planId }, data: { nextPlanId } });
        }

        /*
         * THE SPECIFIC PERSON, named on the Offering itself, same as the real
         * `/manage` flow: a template only ever carries the "lecturer pool"
         * ROLE hint (`requiredRoleId` above), never an individual.
         */
        for (const m of MODULES) {
            const offeringId = offeringIdByModuleCode.get(m.code)!;

            await prisma.offeringLecturer.deleteMany({ where: { offeringId } });
            await prisma.offeringLecturer.create({
                data: {
                    tenantId: t, offeringId,
                    personId: personByKey.get(m.lecturer)!,
                    roleId: lecturerRole?.id ?? null,
                },
            });
        }

        // --- a baseline generation -------------------------------------------
        /*
         * A handful of placements, not a full timetable. Producing the full one
         * is the SOLVER's job, and pre-placing it here would hide whether the
         * solver can: the demo exists to be run against, not to look finished.
         *
         * Placed at block 1, 3, 5 … deliberately: those are the positions a
         * 90-minute session occupies without spanning a break, so the starting
         * point is legal and any break-spanning session in the UI came from an
         * edit or a solve rather than from here.
         */
        /*
         * findFirst + create rather than upsert: `@@unique([tenantId, version])`
         * is gone, because versions are per TERM now and a tenant-wide unique
         * would forbid Semester 1 and Semester 2 both having a v1. The two
         * replacement indexes are partial (`WHERE term_id IS NULL` / `IS NOT
         * NULL`), which Prisma cannot express and therefore cannot offer as a
         * compound-unique `where`.
         *
         * This baseline is deliberately term-LESS: it is one snapshot the whole
         * demo tenant starts from, which is exactly the case `term_id IS NULL`
         * exists for.
         */
        const generation = await prisma.generation.findFirst({
            where: { tenantId: t, termId: null, version: 1 },
        }) ?? await prisma.generation.create({
            data: {
                tenantId: t, termId: null, version: 1,
                source: 'MANUAL_BASELINE', status: 'APPLIED', isCurrent: true,
            },
        });

        /*
         * EVERY block is a legal start now, because every baseline session is
         * one block long and a one-block session cannot span a break. The list
         * existed when a session was two 45-minute blocks and half the
         * positions straddled a gap.
         */
        const legalStarts = Array.from({ length: GRID.blocksPerDay }, (_, i) => i);
        let placed = 0;
        /*
         * RESET PER TERM, not a running count across all six. Every term's
         * baseline is its own "handful of placements": without the reset,
         * Semester 2 onward would start wherever the previous term's count
         * happened to land in the day/block cycle instead of Monday, block 0.
         */
        let termCursor: string | null = null;
        let indexInTerm = 0;
        let sessionIndex = 0;

        for (const offeringId of offeringIds) {
            const offering = await prisma.offering.findUniqueOrThrow({
                where: { id: offeringId },
                include: { groups: true, lecturers: true },
            });

            if (offering.termId !== termCursor) {
                termCursor = offering.termId;
                indexInTerm = 0;
            }

            /*
             * ONE SESSION PER ATTACHED GROUP, mirroring what the solver does
             * with a multi-group Offering (TAXONOMY.md § "What attaching
             * several Groups to one Offering MEANS"), never one shared
             * Session for the union, which would put both halves in the same
             * room at the same time.
             */
            for (const groupLink of offering.groups) {
                const id = `${t}-session-${sessionIndex}`;

                await prisma.session.upsert({
                    where: { id },
                    create: {
                        id, tenantId: t, offeringId, termId: offering.termId,
                        kindId: offering.kindId, timeGridId: grid.id,
                        termWeek: 1,
                        dayOfWeek: GRID.activeDays[indexInTerm % GRID.activeDays.length]!,
                        blockIndex: legalStarts[indexInTerm % legalStarts.length]!,
                        durationBlocks: 1,
                        generationId: generation.id,
                        isLocked: sessionIndex === 0,
                    },
                    update: {},
                });

                /*
                 * THE LAP, not the raw index. Day and block both cycle on
                 * `indexInTerm % 6` above, so every 6th series repeats the same
                 * (day, block) pair, harmless with only a handful of series per
                 * term, but Semester 4-6 now carry up to 20. Cycling the room on
                 * that same period-6 index would make every repeat land in the
                 * same ROOM too, i.e. a real double-booking rather than a
                 * cosmetic one. Indexing by lap instead (how many full sweeps
                 * of the 6 slots this series is into) guarantees the 6 series
                 * sharing one lap get 6 distinct (day, block) pairs, and only
                 * the NEXT lap's repeat of a pair gets a different room.
                 */
                const lap = Math.floor(indexInTerm / GRID.blocksPerDay);

                indexInTerm++;

                const room = rooms[lap % (rooms.length - 1)]!;

                await prisma.sessionRoom.upsert({
                    where: { sessionId_roomId: { sessionId: id, roomId: room.id } },
                    create: { tenantId: t, sessionId: id, roomId: room.id },
                    update: {},
                });

                await prisma.sessionGroup.upsert({
                    where: { sessionId_groupId: { sessionId: id, groupId: groupLink.groupId } },
                    create: { tenantId: t, sessionId: id, groupId: groupLink.groupId },
                    update: {},
                });

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
                sessionIndex++;
            }
        }

        console.log(`  ${KINDS.length} session kinds (${KINDS.filter((k) => k.type === 'EXAM').length} exam-typed)`);
        console.log(`  grid '${grid.name}': ${GRID.blocksPerDay} x ${GRID.blockLengthMinutes}min, ${BREAKS.length} breaks, ${GRID.activeDays.length} days`);
        console.log(`  ${TERMS.length} terms, ${GROUPS.length} groups, ${GROUP_TERMS.length} group-term scopes, ${GROUP_SOURCES.length} group sources`);
        console.log(`  ${LECTURERS.length} lecturers, ${rooms.length} rooms`);
        console.log(`  ${templateByCode.size} offering templates, ${planGroups.size} curriculum plans`);
        console.log(`  ${offeringCount} offerings applied from those plans across all ${TERMS.length} terms, each with a lecturer and one or two groups`);
        console.log(`  ${placed} baseline sessions in week 1; the rest is the solver's job`);
        console.log('Done.');
    } catch (error) {
        console.error(`\nFailed: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

await main();
