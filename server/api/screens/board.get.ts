import { blockSpan } from '../../../shared/timeGrid';
import { isoWeekday, weekIndexOf } from '../../../shared/academicCalendar';
import { requireIdentity, withRequestTenant } from '../../utils/tenantDb';
import { resolveScreenKey } from '../../utils/authDb';

/**
 * What a lobby display shows: today, by ROOM.
 *
 * ROOM-CENTRIC, and that is the whole reason this is a route rather than a
 * query parameter on the schedule. Every existing view answers "when is this
 * group/person busy"; somebody standing in a corridor is asking the transposed
 * question — "what is happening in the rooms around me, and is this one free
 * right now". The grid cannot be reshaped into that answer by filtering.
 *
 * AUTHORITY IS THE KEY, NOT A PERMISSION. A screen resolves to a
 * `ScreenIdentity` whose `actorPersonId` is null, so `requirePermission()` would
 * throw 403 for it no matter which permission were named — deliberately: a
 * display holds no role and must never be able to acquire one. Its authority is
 * its room scope, and this route is the only thing that reads it.
 *
 * A SIGNED-IN HUMAN MAY ALSO CALL IT, gated on `session.read`, so the management
 * UI can preview a screen before anybody mounts it on a wall. That is the same
 * "two callers, different purposes" shape as `GET /api/display-settings`.
 */
export default defineEventHandler(async (event) => {
    const key = getQuery(event).key;

    /*
     * The REVOKED case, answered before identity resolution. The resolver treats
     * an inactive screen as no identity at all — correct for it, since a revoked
     * key must not act — but that would reach the display as a bare 401, which
     * looks exactly like a mistyped URL. A screen that has been deliberately
     * turned off should say so, because that is a fact somebody walking past can
     * act on.
     */
    if (typeof key === 'string' && key) {
        const screen = await resolveScreenKey(key);

        if (!screen) {
            throw createError({ statusCode: 401, statusMessage: 'This screen key is not recognised.' });
        }

        if (!screen.is_active) {
            throw createError({ statusCode: 403, statusMessage: 'This screen has been deactivated.' });
        }
    }

    const identity = requireIdentity(event);

    return withRequestTenant(event, async (tx) => {
        if (identity.kind === 'account') {
            // A human previewing the board still needs the ordinary key; the
            // screen path is exempt because it has no Person to check.
            await requirePermission(event, tx, 'session.read');
        }

        const now = new Date();

        /*
         * The scope, resolved to actual Rooms. An EMPTY `roomIds` means every
         * room — fail-open, matching the table — so it becomes an absent filter
         * rather than `in: []`, which would silently match nothing and produce a
         * blank display for the most common configuration there is.
         */
        const scopedRoomIds = identity.kind === 'screen' ? identity.roomIds : [];
        const rooms = await tx.room.findMany({
            where: {
                isActive: true,
                ...(scopedRoomIds.length ? { id: { in: scopedRoomIds } } : {}),
            },
            orderBy: { name: 'asc' },
        });

        /*
         * A liveness stamp, recorded on EVERY successful fetch and therefore
         * before anything that can return early.
         *
         * Two bugs live here, both shipped and both caught by checking the column
         * rather than the response. First it was a fire-and-forget
         * `getPrisma().$executeRaw` OUTSIDE this transaction, which matched zero
         * rows every time — the app role runs under `FORCE ROW LEVEL SECURITY`
         * and there is no `current_tenant_id()` out there. Then, once inside, it
         * sat AFTER the no-term return, so every display in the institution
         * looked dead for the whole summer.
         */
        if (identity.kind === 'screen') {
            await tx.screen.update({
                where: { id: identity.screenId },
                data: { lastSeenAt: now },
            });
        }

        const term = await tx.term.findFirst({
            where: { startDate: { lte: now }, endDate: { gte: now } },
            include: { timeGrid: { include: { breaks: true } } },
            orderBy: { startDate: 'asc' },
        });

        /*
         * NO TERM RUNNING is a legitimate, common state — the summer between two
         * terms — and it is NAMED rather than left to look like an outage.
         *
         * The rooms still come back, empty. A corridor display in August should
         * read "Room A — Free", which is true and useful, plus a line saying no
         * term is running; returning nothing at all would make a working screen
         * indistinguishable from a broken one for two months of the year. An
         * earlier version returned `rooms: []` here and did exactly that.
         */
        if (!term?.timeGrid) {
            return {
                screenName: identity.kind === 'screen' ? identity.screenName : null,
                generatedAt: now.toISOString(),
                state: 'no-term' as const,
                rooms: rooms.map((room) => ({
                    id: room.id,
                    name: room.name,
                    isVirtual: room.isVirtual,
                    current: null,
                    next: null,
                    entries: [],
                })),
            };
        }

        const grid = term.timeGrid;
        const dayOfWeek = isoWeekday(now);
        // `weekIndexOf` is 0-based; `session.term_week` is 1-based.
        const termWeek = weekIndexOf(term.startDate, now) + 1;

        const sessions = await tx.session.findMany({
            where: {
                termId: term.id,
                termWeek,
                dayOfWeek,
                rooms: { some: { roomId: { in: rooms.map((room) => room.id) } } },
            },
            include: {
                offering: { select: { title: true } },
                kind: { select: { key: true, name: true } },
                rooms: { select: { roomId: true } },
                groups: { include: { group: { select: { name: true } } } },
            },
        });

        const minutesNow = now.getHours() * 60 + now.getMinutes();

        const board = rooms.map((room) => {
            const entries = sessions
                .filter((session) => session.rooms.some((link) => link.roomId === room.id))
                .map((session) => {
                    const first = blockSpan(grid, session.blockIndex, dayOfWeek);
                    const last = blockSpan(grid, session.blockIndex + session.durationBlocks - 1, dayOfWeek);

                    return {
                        id: session.id,
                        title: session.offering?.title ?? session.title ?? session.kind.name,
                        kind: session.kind.key,
                        groups: session.groups.map((link) => link.group.name),
                        startMinute: first.start,
                        endMinute: last.end,
                        /*
                         * Computed server-side, from the same clock that picked
                         * the term week and weekday. A display left running for
                         * months would otherwise decide "now" from a device
                         * whose clock nobody checks, and disagree with the
                         * schedule it is drawing.
                         */
                        isNow: minutesNow >= first.start && minutesNow < last.end,
                    };
                })
                .sort((a, b) => a.startMinute - b.startMinute);

            const current = entries.find((entry) => entry.isNow) ?? null;

            return {
                id: room.id,
                name: room.name,
                isVirtual: room.isVirtual,
                current,
                next: entries.find((entry) => entry.startMinute > minutesNow) ?? null,
                entries,
            };
        });

        return {
            screenName: identity.kind === 'screen' ? identity.screenName : null,
            generatedAt: now.toISOString(),
            state: 'ok' as const,
            termName: term.name,
            rooms: board,
        };
    });
});
