import type { Tx } from './tenantDb';
import type { XlsxSheet } from './xlsxExport';

/**
 * The tenant-wide half of issue #84: everything this institution owns, one
 * sheet per entity, for a departing tenant taking a copy of their data with
 * them (or an administrator answering a Right to Access request that spans
 * more than one Person; `personExport.ts` covers exactly one).
 *
 * DELIBERATELY FLATTER than `personExport.ts`'s bundle: that one tells a
 * human "here is everything about you" and reads accordingly; this one is a
 * bulk data dump; a full roster's worth of relations resolved to friendly
 * labels everywhere would multiply the query count for no reader this tool
 * actually serves. IDs stay IDs; the handful of labels included below (an
 * Offering's title on a Session row, a Person's name on an exam request) are
 * the ones that make a row identifiable without a second lookup, not an
 * attempt at the same narrative shape as the per-Person export.
 *
 * Secrets are still excluded on the same grounds as `personExport.ts`:
 * password hashes and API-token/calendar-link secrets never appear.
 */
export interface TenantExportBundle {
    persons: Record<string, unknown>[];
    accounts: Record<string, unknown>[];
    groups: Record<string, unknown>[];
    rooms: Record<string, unknown>[];
    equipment: Record<string, unknown>[];
    schedulingRoles: Record<string, unknown>[];
    accessRoles: Record<string, unknown>[];
    terms: Record<string, unknown>[];
    timeGrids: Record<string, unknown>[];
    offerings: Record<string, unknown>[];
    sessions: Record<string, unknown>[];
    examRequests: Record<string, unknown>[];
    constraints: Record<string, unknown>[];
    auditLog: Record<string, unknown>[];
}

export async function buildTenantExportBundle(tx: Tx, tenantId: string): Promise<TenantExportBundle> {
    // Sequential: `tx` is one shared connection, and concurrent queries on it
    // trip pg's deprecated overlapping-query warning.
    const persons = await tx.person.findMany({
        where: { tenantId },
        select: {
            id: true, givenName: true, familyName: true, email: true, externalRef: true,
            timezone: true, locale: true, isActive: true, createdAt: true,
        },
        orderBy: { familyName: 'asc' },
    });
    // `account`/`account_person` carry no RLS: the `person: { tenantId }`
    // filter below IS the tenant boundary, the same join-based scoping
    // `accountScope()` (`server/utils/accountAdmin.ts`) uses, not a filter
    // RLS happens to also enforce.
    const accountLinks = await tx.accountPerson.findMany({
        where: { person: { tenantId } },
        select: {
            person: { select: { givenName: true, familyName: true } },
            account: { select: { email: true, isActive: true, lastLoginAt: true, createdAt: true } },
        },
    });
    const groups = await tx.group.findMany({
        where: { tenantId },
        select: { id: true, name: true, description: true, parentGroupId: true, createdAt: true },
        orderBy: { name: 'asc' },
    });
    const rooms = await tx.room.findMany({
        where: { tenantId },
        select: { id: true, code: true, name: true, capacity: true, examCapacity: true, location: true, isVirtual: true },
        orderBy: { name: 'asc' },
    });
    const equipment = await tx.equipment.findMany({
        where: { tenantId },
        select: { id: true, key: true, name: true, description: true },
        orderBy: { name: 'asc' },
    });
    const schedulingRoles = await tx.role.findMany({
        where: { tenantId },
        select: { id: true, key: true, name: true, description: true, isSystem: true },
        orderBy: { name: 'asc' },
    });
    const accessRoles = await tx.accessRole.findMany({
        where: { tenantId },
        select: {
            id: true, key: true, name: true, description: true, isSystem: true,
            permissions: { select: { permissionKey: true } },
        },
        orderBy: { name: 'asc' },
    });
    const terms = await tx.term.findMany({
        where: { tenantId },
        select: { id: true, name: true, startDate: true, endDate: true },
        orderBy: { startDate: 'asc' },
    });
    const timeGrids = await tx.timeGrid.findMany({
        where: { tenantId },
        select: { id: true, name: true, blockLengthMinutes: true, blocksPerDay: true, activeDays: true },
        orderBy: { name: 'asc' },
    });
    const offerings = await tx.offering.findMany({
        where: { tenantId },
        select: {
            id: true, code: true, title: true, frequency: true,
            /*
             * The ROOM RESTRICTION, both halves (issue #123). An Offering's
             * online mode and its room pin are choices somebody made about
             * where their teaching may happen: an export that dropped them
             * would hand a departing tenant a catalogue that silently means
             * "anywhere", which is the same trap the wire's empty
             * `allowed_room_ids` is.
             *
             * Room CODES, not ids, unlike the id columns kept elsewhere in this
             * bundle: the Rooms sheet is keyed by id too, but a pin is only
             * legible next to the Offering if it says "A101, B204".
             */
            onlineMode: true,
            pinnedRooms: { select: { room: { select: { code: true } } } },
            term: { select: { name: true } }, kind: { select: { name: true } },
        },
        orderBy: { title: 'asc' },
    });
    const sessions = await tx.session.findMany({
        where: { tenantId },
        select: {
            id: true, title: true, termWeek: true, dayOfWeek: true, blockIndex: true, durationBlocks: true,
            offering: { select: { title: true } }, term: { select: { name: true } }, kind: { select: { name: true } },
        },
        orderBy: [{ termWeek: 'asc' }, { dayOfWeek: 'asc' }, { blockIndex: 'asc' }],
    });
    const examRequests = await tx.examRequest.findMany({
        where: { tenantId },
        select: {
            id: true, status: true, createdAt: true,
            offering: { select: { title: true } }, term: { select: { name: true } },
            requestedBy: { select: { givenName: true, familyName: true } },
            decidedBy: { select: { givenName: true, familyName: true } },
        },
        orderBy: { createdAt: 'desc' },
    });
    const constraints = await tx.constraint.findMany({
        where: { tenantId },
        select: { id: true, type: true, name: true, severity: true, weight: true, isEnabled: true, isDefault: true },
        orderBy: { name: 'asc' },
    });
    // No RLS on `audit_log` (CLAUDE.md exception 5): explicit `tenantId`
    // filter is the whole boundary, matching every other read of this
    // table.
    const auditLog = await tx.auditLog.findMany({
        where: { tenantId },
        select: { id: true, action: true, outcome: true, actorLabel: true, target: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
    });

    return {
        persons,
        accounts: accountLinks.map((l) => ({
            personName: `${l.person.givenName} ${l.person.familyName}`.trim(),
            email: l.account.email,
            isActive: l.account.isActive,
            lastLoginAt: l.account.lastLoginAt,
            createdAt: l.account.createdAt,
        })),
        groups,
        rooms,
        equipment,
        schedulingRoles,
        accessRoles: accessRoles.map((r) => ({
            id: r.id, key: r.key, name: r.name, description: r.description, isSystem: r.isSystem,
            permissions: r.permissions.map((p) => p.permissionKey).join(', '),
        })),
        terms,
        timeGrids,
        offerings: offerings.map((o) => ({
            id: o.id,
            code: o.code,
            title: o.title,
            frequency: o.frequency,
            termName: o.term.name,
            kindName: o.kind.name,
            onlineMode: o.onlineMode,
            // Empty means "any eligible room", which is what the column header
            // cannot say on its own, so the empty cell says it instead.
            pinnedRooms: o.pinnedRooms.length > 0
                ? o.pinnedRooms.map((link) => link.room.code).sort().join(', ')
                : 'Any eligible room',
        })),
        sessions: sessions.map((s) => ({
            id: s.id,
            label: s.offering?.title ?? s.title ?? 'Untitled event',
            termName: s.term.name,
            kindName: s.kind.name,
            termWeek: s.termWeek,
            dayOfWeek: s.dayOfWeek,
            blockIndex: s.blockIndex,
            durationBlocks: s.durationBlocks,
        })),
        examRequests: examRequests.map((r) => ({
            id: r.id,
            offeringTitle: r.offering.title,
            termName: r.term.name,
            status: r.status,
            requestedBy: r.requestedBy ? `${r.requestedBy.givenName} ${r.requestedBy.familyName}`.trim() : null,
            decidedBy: r.decidedBy ? `${r.decidedBy.givenName} ${r.decidedBy.familyName}`.trim() : null,
            createdAt: r.createdAt,
        })),
        constraints,
        auditLog,
    };
}

/** One sheet per entity in the bundle, columns derived from the first row (or a single-blank-row placeholder when empty, so the sheet still exists and states what it covers). */
export function tenantExportToSheets(bundle: TenantExportBundle): XlsxSheet[] {
    const entries: [string, Record<string, unknown>[]][] = [
        ['Persons', bundle.persons],
        ['Accounts', bundle.accounts],
        ['Groups', bundle.groups],
        ['Rooms', bundle.rooms],
        ['Equipment', bundle.equipment],
        ['Scheduling roles', bundle.schedulingRoles],
        ['Access roles', bundle.accessRoles],
        ['Terms', bundle.terms],
        ['Time grids', bundle.timeGrids],
        ['Offerings', bundle.offerings],
        ['Sessions', bundle.sessions],
        ['Exam requests', bundle.examRequests],
        ['Constraints', bundle.constraints],
        ['Audit trail', bundle.auditLog],
    ];

    return entries.map(([name, rows]) => {
        const keys = rows.length > 0 ? Object.keys(rows[0] as Record<string, unknown>) : ['note'];

        return {
            name,
            columns: keys.map((key) => ({ header: humanize(key), key })),
            rows: rows.length > 0 ? rows : [{ note: 'No rows.' }],
        };
    });
}

/** `termWeek` → `Term week`. Sheet headers only; not a general-purpose formatter. */
function humanize(key: string): string {
    const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

    return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}
