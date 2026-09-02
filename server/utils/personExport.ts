import type { Tx } from './tenantDb';
import type { XlsxSheet } from './xlsxExport';

/**
 * GDPR Right to Access, per Person (issue #84). Everything this application
 * holds ABOUT one Person, gathered from every table that names them:
 * scheduling data (TAXONOMY.md §2/§3), authorization grants (§4), the
 * credential that signs them in, and their own slice of the security audit
 * trail (issue #78).
 *
 * DELIBERATELY EXCLUDED, both for the same reason: a full export must not
 * hand out a live credential, only an account of what exists:
 *   - `ApiToken.tokenHash` / `IcsLink.token`: secrets, not personal data
 *     the request is entitled to see in the clear.
 *   - `AccountPerson`/`Account.passwordHash`: never leaves the database at
 *     all.
 * Both tables are still represented, by name/metadata only (see
 * `apiTokens`/`icsLinks` below).
 */
export interface PersonExportBundle {
    person: {
        id: string;
        givenName: string;
        familyName: string;
        email: string | null;
        externalRef: string | null;
        timezone: string | null;
        locale: string | null;
        isActive: boolean;
        createdAt: Date;
    };
    account: {
        id: string;
        email: string;
        isActive: boolean;
        lastLoginAt: Date | null;
        createdAt: Date;
    } | null;
    schedulingRoles: { roleKey: string; roleName: string }[];
    accessRoles: { accessRoleKey: string; accessRoleName: string; grantedAt: Date; isDefaultGrant: boolean }[];
    groupMemberships: { groupId: string; groupName: string; joinedAt: Date }[];
    teaching: { offeringId: string; offeringTitle: string; roleName: string | null }[];
    sessionsAttended: {
        sessionId: string;
        label: string;
        termName: string;
        termWeek: number | null;
        dayOfWeek: number | null;
        blockIndex: number | null;
        roleName: string | null;
    }[];
    unavailability: {
        id: string;
        days: number[];
        blocks: number[];
        reason: string | null;
        status: string;
        createdAt: Date;
        decidedAt: Date | null;
    }[];
    preferences: {
        preferredDays: number[];
        preferredBlocks: number[];
        weightMultiplier: number | null;
        roomFeatures: string[];
    } | null;
    examRequests: {
        id: string;
        offeringTitle: string;
        termName: string;
        status: string;
        role: 'requested_by' | 'decided_by';
        createdAt: Date;
    }[];
    apiTokens: {
        id: string;
        name: string;
        permissions: string[];
        isActive: boolean;
        lastUsedAt: Date | null;
        expiresAt: Date | null;
        createdAt: Date;
    }[];
    icsLinks: {
        id: string;
        name: string;
        scope: string;
        lastUsedAt: Date | null;
        createdAt: Date;
    }[];
    auditLog: {
        id: string;
        action: string;
        outcome: string;
        target: string | null;
        createdAt: Date;
    }[];
}

/**
 * Gathers everything the export covers, inside the caller's own tenant
 * transaction: every query below runs behind ordinary RLS, exactly like any
 * other route, so this can never be handed a `personId` outside the caller's
 * tenant without also passing `tenantId` and having every `where` clause
 * agree; `personRow` below still checks explicitly, matching the "guards
 * must fail loudly" rule, rather than trusting an empty result set to mean
 * the same thing as "not found".
 */
export async function buildPersonExportBundle(tx: Tx, tenantId: string, personId: string): Promise<PersonExportBundle> {
    const personRow = await tx.person.findFirst({
        where: { id: personId, tenantId },
        select: {
            id: true,
            givenName: true,
            familyName: true,
            email: true,
            externalRef: true,
            timezone: true,
            locale: true,
            isActive: true,
            createdAt: true,
        },
    });

    if (!personRow) {
        throw createError({ statusCode: 404, statusMessage: 'Not found.' });
    }

    // Sequential: `tx` is one shared connection; concurrent queries on it
    // trip pg's deprecated overlapping-query warning.
    const accountLink = await tx.accountPerson.findUnique({
        where: { personId },
        select: { account: { select: { id: true, email: true, isActive: true, lastLoginAt: true, createdAt: true } } },
    });
    const personRoles = await tx.personRole.findMany({ where: { personId }, select: { role: { select: { key: true, name: true } } } });
    const accessRoles = await tx.personAccessRole.findMany({
        where: { personId },
        select: { createdAt: true, isDefaultGrant: true, accessRole: { select: { key: true, name: true } } },
    });
    const memberships = await tx.membership.findMany({
        where: { personId },
        select: { createdAt: true, group: { select: { id: true, name: true } } },
    });
    const teaching = await tx.offeringLecturer.findMany({
        where: { personId },
        select: { role: { select: { name: true } }, offering: { select: { id: true, title: true } } },
    });
    const sessionsAttended = await tx.sessionPerson.findMany({
        where: { personId },
        select: {
            role: { select: { name: true } },
            session: {
                select: {
                    id: true,
                    title: true,
                    termWeek: true,
                    dayOfWeek: true,
                    blockIndex: true,
                    offering: { select: { title: true } },
                    term: { select: { name: true } },
                },
            },
        },
    });
    const unavailability = await tx.personUnavailability.findMany({
        where: { personId },
        select: { id: true, days: true, blocks: true, reason: true, status: true, createdAt: true, decidedAt: true },
    });
    const preference = await tx.personPreference.findUnique({
        where: { personId },
        select: {
            preferredDays: true,
            preferredBlocks: true,
            weightMultiplier: true,
            roomFeatures: { select: { equipment: { select: { name: true } } } },
        },
    });
    const examRequestsMade = await tx.examRequest.findMany({
        where: { requestedByPersonId: personId },
        select: { id: true, status: true, createdAt: true, offering: { select: { title: true } }, term: { select: { name: true } } },
    });
    const examRequestsDecided = await tx.examRequest.findMany({
        where: { decidedByPersonId: personId },
        select: { id: true, status: true, createdAt: true, offering: { select: { title: true } }, term: { select: { name: true } } },
    });
    const apiTokens = await tx.apiToken.findMany({
        where: { personId },
        select: { id: true, name: true, permissions: true, isActive: true, lastUsedAt: true, expiresAt: true, createdAt: true },
    });
    const icsLinks = await tx.icsLink.findMany({
        where: { personId },
        select: { id: true, name: true, scope: true, lastUsedAt: true, createdAt: true },
    });
    // No RLS on `audit_log` (CLAUDE.md exception 5): scoped by BOTH
    // `tenantId` and `actorPersonId` explicitly, since the table carries
    // no FK to enforce it for us.
    const auditLog = await tx.auditLog.findMany({
        where: { tenantId, actorPersonId: personId },
        select: { id: true, action: true, outcome: true, target: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
    });

    return {
        person: personRow,
        account: accountLink
            ? {
                id: accountLink.account.id,
                email: accountLink.account.email,
                isActive: accountLink.account.isActive,
                lastLoginAt: accountLink.account.lastLoginAt,
                createdAt: accountLink.account.createdAt,
            }
            : null,
        schedulingRoles: personRoles.map((r) => ({ roleKey: r.role.key, roleName: r.role.name })),
        accessRoles: accessRoles.map((r) => ({
            accessRoleKey: r.accessRole.key,
            accessRoleName: r.accessRole.name,
            grantedAt: r.createdAt,
            isDefaultGrant: r.isDefaultGrant,
        })),
        groupMemberships: memberships.map((m) => ({ groupId: m.group.id, groupName: m.group.name, joinedAt: m.createdAt })),
        teaching: teaching.map((t) => ({
            offeringId: t.offering.id,
            offeringTitle: t.offering.title,
            roleName: t.role?.name ?? null,
        })),
        sessionsAttended: sessionsAttended.map((sp) => ({
            sessionId: sp.session.id,
            label: sp.session.offering?.title ?? sp.session.title ?? 'Untitled event',
            termName: sp.session.term.name,
            termWeek: sp.session.termWeek,
            dayOfWeek: sp.session.dayOfWeek,
            blockIndex: sp.session.blockIndex,
            roleName: sp.role?.name ?? null,
        })),
        unavailability: unavailability.map((u) => ({
            id: u.id,
            days: u.days,
            blocks: u.blocks,
            reason: u.reason,
            status: u.status,
            createdAt: u.createdAt,
            decidedAt: u.decidedAt,
        })),
        preferences: preference
            ? {
                preferredDays: preference.preferredDays,
                preferredBlocks: preference.preferredBlocks,
                weightMultiplier: preference.weightMultiplier,
                roomFeatures: preference.roomFeatures.map((f) => f.equipment.name),
            }
            : null,
        examRequests: [
            ...examRequestsMade.map((r) => ({
                id: r.id,
                offeringTitle: r.offering.title,
                termName: r.term.name,
                status: r.status,
                role: 'requested_by' as const,
                createdAt: r.createdAt,
            })),
            ...examRequestsDecided.map((r) => ({
                id: r.id,
                offeringTitle: r.offering.title,
                termName: r.term.name,
                status: r.status,
                role: 'decided_by' as const,
                createdAt: r.createdAt,
            })),
        ],
        apiTokens: apiTokens.map((t) => ({
            id: t.id,
            name: t.name,
            permissions: t.permissions,
            isActive: t.isActive,
            lastUsedAt: t.lastUsedAt,
            expiresAt: t.expiresAt,
            createdAt: t.createdAt,
        })),
        icsLinks: icsLinks.map((l) => ({ id: l.id, name: l.name, scope: l.scope, lastUsedAt: l.lastUsedAt, createdAt: l.createdAt })),
        auditLog,
    };
}

/** One sheet per category, matching the confirmed shape from issue #84's clarification. */
export function personExportToSheets(bundle: PersonExportBundle): XlsxSheet[] {
    return [
        {
            name: 'Profile',
            columns: [
                { header: 'Given name', key: 'givenName' },
                { header: 'Family name', key: 'familyName' },
                { header: 'Email', key: 'email' },
                { header: 'External reference', key: 'externalRef' },
                { header: 'Timezone', key: 'timezone' },
                { header: 'Locale', key: 'locale' },
                { header: 'Active', key: 'isActive' },
                { header: 'Created', key: 'createdAt' },
                { header: 'Login email', key: 'accountEmail' },
                { header: 'Login active', key: 'accountActive' },
                { header: 'Last sign-in', key: 'accountLastLoginAt' },
            ],
            rows: [{
                ...bundle.person,
                accountEmail: bundle.account?.email ?? null,
                accountActive: bundle.account?.isActive ?? null,
                accountLastLoginAt: bundle.account?.lastLoginAt ?? null,
            }],
        },
        {
            name: 'Roles',
            columns: [
                { header: 'Scheduling role', key: 'roleName' },
                { header: 'Access role', key: 'accessRoleName' },
                { header: 'Granted', key: 'grantedAt' },
                { header: 'Default grant', key: 'isDefaultGrant' },
            ],
            rows: [
                ...bundle.schedulingRoles.map((r) => ({ roleName: r.roleName, accessRoleName: null, grantedAt: null, isDefaultGrant: null })),
                ...bundle.accessRoles.map((r) => ({ roleName: null, accessRoleName: r.accessRoleName, grantedAt: r.grantedAt, isDefaultGrant: r.isDefaultGrant })),
            ],
        },
        {
            name: 'Groups',
            columns: [
                { header: 'Group', key: 'groupName' },
                { header: 'Joined', key: 'joinedAt' },
            ],
            rows: bundle.groupMemberships,
        },
        {
            name: 'Teaching',
            columns: [
                { header: 'Offering', key: 'offeringTitle' },
                { header: 'Role', key: 'roleName' },
            ],
            rows: bundle.teaching,
        },
        {
            name: 'Sessions',
            columns: [
                { header: 'Session', key: 'label' },
                { header: 'Term', key: 'termName' },
                { header: 'Week', key: 'termWeek' },
                { header: 'Day', key: 'dayOfWeek' },
                { header: 'Block', key: 'blockIndex' },
                { header: 'Role', key: 'roleName' },
            ],
            rows: bundle.sessionsAttended,
        },
        {
            name: 'Unavailability',
            columns: [
                { header: 'Days', key: 'days' },
                { header: 'Blocks', key: 'blocks' },
                { header: 'Reason', key: 'reason' },
                { header: 'Status', key: 'status' },
                { header: 'Submitted', key: 'createdAt' },
                { header: 'Decided', key: 'decidedAt' },
            ],
            rows: bundle.unavailability,
        },
        {
            name: 'Preferences',
            columns: [
                { header: 'Preferred days', key: 'preferredDays' },
                { header: 'Preferred blocks', key: 'preferredBlocks' },
                { header: 'Weight multiplier', key: 'weightMultiplier' },
                { header: 'Preferred room features', key: 'roomFeatures' },
            ],
            rows: bundle.preferences ? [bundle.preferences] : [],
        },
        {
            name: 'Exam requests',
            columns: [
                { header: 'Offering', key: 'offeringTitle' },
                { header: 'Term', key: 'termName' },
                { header: 'Status', key: 'status' },
                { header: 'Your role', key: 'role' },
                { header: 'Created', key: 'createdAt' },
            ],
            rows: bundle.examRequests,
        },
        {
            name: 'API tokens',
            columns: [
                { header: 'Name', key: 'name' },
                { header: 'Permissions', key: 'permissions' },
                { header: 'Active', key: 'isActive' },
                { header: 'Last used', key: 'lastUsedAt' },
                { header: 'Expires', key: 'expiresAt' },
                { header: 'Created', key: 'createdAt' },
            ],
            rows: bundle.apiTokens,
        },
        {
            name: 'Calendar links',
            columns: [
                { header: 'Name', key: 'name' },
                { header: 'Scope', key: 'scope' },
                { header: 'Last used', key: 'lastUsedAt' },
                { header: 'Created', key: 'createdAt' },
            ],
            rows: bundle.icsLinks,
        },
        {
            name: 'Audit trail',
            columns: [
                { header: 'Action', key: 'action' },
                { header: 'Outcome', key: 'outcome' },
                { header: 'Target', key: 'target' },
                { header: 'When', key: 'createdAt' },
            ],
            rows: bundle.auditLog,
        },
    ];
}
