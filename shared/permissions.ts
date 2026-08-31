/**
 * The fixed permission catalogue (TAXONOMY.md §4). Tenants configure ROLES —
 * named bundles of these — but never the permissions themselves.
 *
 * In `shared/` because four consumers must not disagree about the list: the seed
 * that mirrors it into the `permission` table, the operator CLIs, the API
 * validator, and the role editor. The editor renders from THIS catalogue, never
 * from a fetch of the table, so a permission the code implements but the database
 * lacks is reported rather than silently missing from a list that looks complete.
 *
 * Adding one: add it here, run `db seed`, then `bun run grant:permissions --role
 * tenant-admin --all-missing` on every EXISTING tenant — provisioning grants the
 * catalogue only at creation time, so without that step the symptom is a 403 on a
 * feature that visibly exists.
 */

/** Entities served by the generic CRUD routes, and their permission prefix. */
export const CRUD_RESOURCES = {
    persons: 'person',
    roles: 'role',
    groups: 'group',
    rooms: 'room',
    equipment: 'equipment',
    offerings: 'offering',
    /**
     * Issue #8. A REUSABLE SHAPE a tenant authors, not the constraint
     * catalogue's code-level defaults it takes its structural cue from —
     * hence its own CRUD permissions rather than folding into `offering.*`.
     * Reading a template and reading the Offerings it seeded are genuinely
     * separate authorities: a lecturer who may see the timetable has no
     * business editing the tenant's library of reusable shapes.
     */
    'offering-templates': 'offering_template',
    'time-grids': 'time_grid',
    terms: 'term',
    constraints: 'constraint',
    // Tenant-open vocabulary (TAXONOMY.md §1). `session_kind`, not `session`:
    // renaming the vocabulary is not the authority to move the timetable.
    // Session can carry. Added in Step 13 because there was no way to create one
    // — provisioning deliberately makes none, so a fresh tenant could not create
    // an Offering at all, its `kindId` being a required FK to a table with no
    // rows and no route.
    //
    // Note `session_kind`, not `session`: session.read/move/swap/lock are about
    // placed Sessions. Being able to rename the vocabulary is not the same
    // authority as being able to move the timetable.
    'session-kinds': 'session_kind',
    /**
     * The academic calendar, mapped to `term` rather than a permission of its
     * own: a calendar period is a child of Term with a mandatory `term_id`, and
     * changing when an exam period falls IS editing the term. A separate key
     * would need a backfill on every existing tenant.
     */
    'calendar-periods': 'term',
} as const;

export type CrudAction = 'read' | 'create' | 'update' | 'delete';

/**
 * Prefixes, DEDUPLICATED — two segments share `term` on purpose. `CrudResource`
 * is the segment, `CrudPrefix` what the permission is named after; conflating
 * them produced the duplicate-key bug below.
 */
export type CrudResource = keyof typeof CRUD_RESOURCES;
export type CrudPrefix = (typeof CRUD_RESOURCES)[CrudResource];

const CRUD_ACTIONS = ['read', 'create', 'update', 'delete'] as const;

interface PermissionShape {
    key: string;
    category: string;
    description: string;
}

/**
 * Everything that is not a CRUD verb on a managed entity.
 *
 * `as const satisfies`, not an annotation: `satisfies` checks the shape without
 * WIDENING the literals, which is what lets `PermissionKey` be a real union
 * instead of `string`.
 */
const EXPLICIT_PERMISSIONS = [
    // Lobby displays. A screen KEY is a credential that reads this tenant's room
    // timetable with no login, so issuing one is deliberately a separate
    // authority from merely seeing that screens exist.
    { key: 'screen.read', category: 'screen', description: 'See the lobby displays and which rooms each shows' },
    { key: 'screen.manage', category: 'screen', description: 'Create, re-scope, revoke and delete lobby displays, and issue their keys' },
    // Session editing — explicit verbs, mirroring the routes (TAXONOMY.md §3).
    /**
     * THE WHOLE timetable, everybody's sessions included. Sharpened from "View
     * the schedule", which was true and unhelpful once there were two ways to
     * see one: a role author choosing between these needs the difference in the
     * words, not in a document.
     *
     * The key did NOT change. `session.read_own` is an ADDITION, and minting
     * `session.read_any` alongside it would have left two names for one
     * authority — while renaming this one would silently strip the capability
     * from every hand-composed role in every existing tenant, since the backfill
     * only repairs `tenant-admin`. See CLAUDE.md's rule about moving keys.
     */
    { key: 'session.read', category: 'session', description: "View the whole schedule, including other people's sessions" },
    /**
     * YOUR OWN sessions and nothing else: the ones you are attached to, plus the
     * ones assigned to a Group you belong to (membership flows DOWN, so a
     * cohort-wide lecture reaches its seminars — TAXONOMY.md §6).
     *
     * THE DEFAULT ROLE'S KEY. Provisioning grants it to `member`, because
     * "everyone at this institution can see their own timetable" is the baseline
     * a calendar product is for, and until now the smallest role that could see
     * anything at all needed six read permissions covering the entire roster.
     *
     * IT IMPLIES NOTHING ELSE, and that is the point. `/schedule` used to demand
     * `person.read`, `room.read`, `group.read`, `term.read` and `time_grid.read`
     * as well, because its reference wave fetched the whole directory to put
     * names on chips. A lecturer does not need to be able to query the staff
     * list to be told which room they are teaching in — so the names for what
     * they can see travel with it (`GET /api/schedule/context`), and the
     * directory endpoints stay behind their own keys, feeding filters and
     * pickers that are simply absent without them.
     */
    { key: 'session.read_own', category: 'session', description: 'View your own sessions — the ones you are in' },
    { key: 'session.create', category: 'session', description: 'Create a Session or Event directly' },
    { key: 'session.move', category: 'session', description: 'Re-place a Session' },
    { key: 'session.swap', category: 'session', description: 'Swap two Sessions' },
    { key: 'session.lock', category: 'session', description: 'Lock or unlock a Session' },
    /**
     * Its own permission: an Event carries no Offering, so nothing re-creates it
     * and deletion is irreversible in a way creation is not. Lets a tenant grant
     * "put things on the calendar" without "take them off".
     */
    { key: 'session.update', category: 'session', description: "Edit an Event's title, kind, groups and people" },
    /**
     * Override which lecturer leads a Session, once it is LOCKED (or it is an
     * Event, which is always safe — see the route's own comment for why).
     *
     * A SEPARATE KEY FROM `session.update`, which only ever touches Events:
     * this one also reaches a locked Offering-linked Session, a state that
     * route explicitly refuses. Folding the two together would grant "edit a
     * locked Session's lecturer" to anyone holding "rename this Event",
     * which is a materially bigger authority than the label promises.
     */
    { key: 'session.assign_lecturer', category: 'session', description: 'Override which lecturer leads a locked session' },
    /**
     * Covering a Session someone cannot teach — Vertretung (issue #30). A
     * SEPARATE KEY FROM `session.assign_lecturer` and `session.update`: covering
     * is an operational act (today's absence handled), not an editing authority
     * over the Session or the Offering behind it, and does not need the Session
     * locked — nothing here touches `session_person` or the solver's next input.
     */
    { key: 'session.substitute', category: 'session', description: 'Cover a session someone else cannot teach, without changing who normally leads it' },
    { key: 'session.delete', category: 'session', description: 'Delete an Event (a Session with no Offering)' },
    /**
     * Cancel an Offering-linked Session to the spare bank, or place a banked
     * one back onto the grid (issue #22) — a separate key from `session.move`
     * on purpose. Moving a Session within the week is routine; pulling it off
     * the timetable entirely — even though the row and its demand survive —
     * is closer in weight to deleting an Event, and a tenant may want to grant
     * the two separately rather than folding "cancel teaching" into "reposition
     * it".
     */
    { key: 'session.bank', category: 'session', description: 'Cancel a Session to the spare bank, or place one back' },

    // Operations
    /**
     * READING proposals, separate from applying one.
     *
     * A Generation is a set of PROPOSED placements; `session.read` is authority
     * over the applied timetable. Conflating them — which is what gating the
     * proposal routes on `session.read` did — meant everybody who could look at
     * a schedule was also offered "Proposals" in the navigation and could read
     * every solver run's output. Two different data sets, two permissions.
     *
     * Read is NOT implied by `generation.apply`, and deliberately not folded
     * into it: they are granted to the same person in practice, but a catalogue
     * with no implication mechanism must not pretend to have one.
     */
    { key: 'generation.read', category: 'generation', description: 'View solver proposals and their previews' },
    { key: 'generation.apply', category: 'generation', description: 'Promote a Generation to the current baseline' },
    { key: 'solver.trigger', category: 'solver', description: 'Request a solver run' },
    /*
     * Separate from `solver.trigger` deliberately: the snapshot is a tenant's
     * whole scheduling configuration at one moment — people, groups, rooms,
     * preferences — the single most sensitive payload the app stores. Being
     * able to start or watch a run should not imply being able to download
     * everyone's data.
     */
    { key: 'solver.snapshot.read', category: 'solver', description: 'Download the full SolverInput a run sent' },
    { key: 'violation.read', category: 'violation', description: 'View current constraint violations' },
    { key: 'notification.preview', category: 'notification', description: 'Resolve who a Session change affects' },

    /**
     * Availability. `manage_own` covers reading and writing your own settings in
     * one key — splitting it would allow "may write but not read your own", and
     * this catalogue has no implication mechanism.
     *
     * Grantable rather than an inherent right, deliberately: the data is yours,
     * the CONSEQUENCE is the tenant's, since an unreviewed veto can make a term
     * infeasible. It carries no "own row only" semantics — that scoping is
     * structural, because `/api/me/*` takes no person id at all.
     *
     * `manage_any` is not folded into `person.update`: widening "rename people"
     * to "declare when the timetable may not use them" would be a silent
     * authority increase for everyone already holding it.
     */
    { key: 'availability.manage_own', category: 'availability', description: 'Set your own unavailability and teaching preferences' },
    { key: 'availability.read_any', category: 'availability', description: "View anyone's unavailability and preferences" },
    { key: 'availability.manage_any', category: 'availability', description: 'Set, approve and reject unavailability for anyone' },

    /**
     * Exams a lecturer asks for on their own modules.
     *
     * TWO KEYS AND NOT ONE, because the card that asked for this said the two
     * flows need different authority and it is right: `request_own` is held by
     * every lecturer and reaches only Offerings the holder LEADS, while
     * `review` decides for the institution and can record an exam for anybody.
     *
     * NOT FOLDED INTO `session.create`. That key creates a Session anywhere,
     * for anyone, immediately — granting it to every lecturer so they could ask
     * for their own exam would hand out the whole schedule to get one square of
     * it. The scope is the point: `request_own` creates NOTHING until a
     * decision, and the Offering it names is checked against the acting Person.
     */
    { key: 'exam.request_own', category: 'session', description: 'Request an exam for a module you lead' },
    { key: 'exam.review', category: 'session', description: 'Approve or reject exam requests, and record one for anyone' },

    /**
     * A lecturer's own choice of HOW their module is taught across the term —
     * `Offering.schedulingPattern` (issue #28), the same field
     * `offering.update` already writes for an administrator. This key is a
     * NARROWER grant of that same write, scoped to Offerings the caller
     * actually leads, so a tenant can hand it to every lecturer without
     * handing out `offering.update` (title, groups, capacity, everything
     * else an Offering is).
     *
     * Same shape as `exam.request_own`: the Offering named in the request is
     * checked against `OfferingLecturer`, never assumed from a role or from
     * holding this key alone. See `assertLecturesOffering`.
     */
    { key: 'offering.set_scheduling_pattern', category: 'offering', description: 'Set the teaching pattern of a module you lead (spread across the term, or kept together)' },

    // Administration
    { key: 'access_role.manage', category: 'administration', description: 'Create and edit access roles' },
    { key: 'person_access_role.assign', category: 'administration', description: 'Grant or revoke access roles' },

    /**
     * The LOGIN plane, which is not a Person (TAXONOMY.md §4 vs §2).
     *
     * TWO KEYS, NOT FOUR CRUD VERBS, for the same reason `access_role` has two:
     * what a tenant actually decides is "may audit the logins" versus "may mint,
     * relink and reset them", and there is no coherent middle where somebody may
     * create an Account but not reset its password — both hand out a working
     * credential.
     *
     * SEPARATE FROM `person.*` deliberately. Creating a Person is scheduling
     * data; creating an Account is issuing a credential. Folding the second into
     * `person.create` would silently promote every roster editor in every
     * existing tenant into someone who can hand out logins.
     */
    { key: 'account.read', category: 'administration', description: 'See which logins exist in this institution' },
    { key: 'account.manage', category: 'administration', description: 'Create logins, attach them to people, reset passwords' },

    /**
     * The institution's OWN settings, as opposed to the entities inside it.
     *
     * Its own category rather than `administration`, because this is where every
     * future tenant-level setting belongs — display, timezone, name — and a
     * heading that reads "Institution" is what tells a role author that these
     * are not about people or rooms.
     *
     * `tenant` is deliberately NOT in `CRUD_RESOURCES`: a Tenant is not a
     * managed entity here (nobody creates or deletes one from inside it), so
     * there is no `tenant.create`/`tenant.delete` and the prefix rule never
     * generates any. Two keys, matching what a tenant actually decides.
     *
     * `tenant.update` REPLACED `session_kind.update` on the display-settings
     * write. That was chosen when minting a permission looked disproportionate;
     * it stopped being defensible the moment the page had a gate of its own,
     * because a role could then hold the write and never see the page. Any
     * custom role relying on the old pairing needs `tenant.update` granted —
     * CLAUDE.md § "Bootstrap & deploy sequence".
     */
    { key: 'tenant.read', category: 'tenant', description: "View this institution's own settings" },
    { key: 'tenant.update', category: 'tenant', description: "Change this institution's own settings" },
] as const satisfies readonly PermissionShape[];

/**
 * A UNION rather than `string`, so a checkbox bound to a key outside the
 * catalogue is a compile error rather than a foreign-key violation found by a
 * tenant.
 */
export type PermissionKey = `${CrudPrefix}.${CrudAction}` | (typeof EXPLICIT_PERMISSIONS)[number]['key'];

export interface PermissionDef {
    key: PermissionKey;
    category: string;
    description: string;
}

/**
 * Over DISTINCT PREFIXES, not entries: `calendar-periods` maps to `term`, so
 * iterating entries emitted `term.*` twice. `provision-tenant.ts` inserts this
 * with one `createMany` and no `skipDuplicates`, so provisioning a new tenant
 * failed outright. A `Set` means the duplication never exists.
 * Pinned by tests/permission-catalogue.test.ts.
 */
function crudPermissions(): PermissionDef[] {
    const out: PermissionDef[] = [];

    for (const prefix of new Set(Object.values(CRUD_RESOURCES))) {
        for (const action of CRUD_ACTIONS) {
            out.push({
                key: `${prefix}.${action}`,
                category: prefix,
                description: `${action} ${prefix.replace('_', ' ')} records`,
            });
        }
    }

    return out;
}

export const PERMISSIONS: readonly PermissionDef[] = [...crudPermissions(), ...EXPLICIT_PERMISSIONS];

export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSIONS.map((p) => p.key);

const PERMISSION_KEY_SET: ReadonlySet<string> = new Set<string>(PERMISSION_KEYS);

/**
 * The single place `unknown` becomes `PermissionKey`, so a bad key is rejected
 * once, at the boundary, with the key named.
 */
export function isPermissionKey(value: unknown): value is PermissionKey {
    return typeof value === 'string' && PERMISSION_KEY_SET.has(value);
}

export function findPermission(key: string): PermissionDef | undefined {
    return PERMISSIONS.find((permission) => permission.key === key);
}

export interface PermissionCategory {
    key: string;
    permissions: PermissionDef[];
}

/**
 * Grouped for display in catalogue order, not sorted: a sort would put
 * `access_role` first, which is the least commonly granted group.
 */
export function permissionCategories(): PermissionCategory[] {
    const byKey = new Map<string, PermissionCategory>();

    for (const permission of PERMISSIONS) {
        const existing = byKey.get(permission.category);

        if (existing) {
            existing.permissions.push(permission);
        } else {
            byKey.set(permission.category, { key: permission.category, permissions: [permission] });
        }
    }

    return [...byKey.values()];
}

/**
 * Resources whose permissions are NOT `<prefix>.<action>`.
 *
 * `access_role` forced this: the catalogue has held `access_role.manage` and
 * `person_access_role.assign` from the start — two capabilities, not eight CRUD
 * verbs — and inventing the CRUD shape would mean re-seeding and backfilling
 * every tenant to end up with `access_role.manage` checked by nothing.
 *
 * ANY listed permission suffices, which matters for reading the role list: the
 * manage section needs `access_role.manage`, but the Person page's role picker
 * needs the same list under `person_access_role.assign`.
 *
 * SHARED, not server-only: the routes enforce this map and the management UI has
 * to PREDICT it, so a page never assembles a fetch wave it will be refused.
 */
export const RESOURCE_PERMISSIONS: Record<string, Partial<Record<CrudAction, readonly PermissionKey[]>>> = {
    'access-roles': {
        read: ['access_role.manage', 'person_access_role.assign'],
        create: ['access_role.manage'],
        update: ['access_role.manage'],
        delete: ['access_role.manage'],
    },
    /**
     * `accounts` is NOT in `CRUD_RESOURCES` and never will be: `account` carries
     * no `tenant_id` and no RLS (the pre-tenant auth plane), so the generic
     * routes' `where: { tenantId }` would match nothing at all. It has its own
     * handlers under `server/api/accounts/`, which read this map through
     * `crudPermission()` exactly as the generic ones do — declared HERE rather
     * than inline in those files so the management UI can predict the gate
     * without knowing which routes are bespoke.
     *
     * `read` accepts `account.manage` too: somebody who may issue a login can
     * obviously see the list, and requiring both keys would make a
     * one-permission role render an empty page.
     */
    accounts: {
        read: ['account.read', 'account.manage'],
        create: ['account.manage'],
        update: ['account.manage'],
        delete: ['account.manage'],
    },
    /**
     * `screens` has its own handlers for a different reason from `accounts`: a
     * Screen is properly tenant-scoped and RLS-protected, but it carries a
     * SECRET, and the generic routes return the row they wrote. The key must be
     * returned exactly once by `POST` and never again by anything, which is a
     * response shape the scaffold cannot express.
     *
     * `read` accepts `screen.manage` too, same reasoning as accounts: whoever
     * may issue a display key can obviously see the list.
     */
    screens: {
        read: ['screen.read', 'screen.manage'],
        create: ['screen.manage'],
        update: ['screen.manage'],
        delete: ['screen.manage'],
    },
};

/**
 * Permissions accepted for one action on a resource — ANY one is sufficient.
 *
 * `undefined` means the question cannot be answered: either the resource is not
 * served by the generic routes at all, or it is declared above and does not
 * name this action. The two are different problems and the caller distinguishes
 * them — the API answers 404 for the first and 500 for the second, rather than
 * falling through to a prefix rule that would gate a write on a permission
 * nobody chose.
 */
export function resourcePermissions(
    resource: string,
    action: CrudAction,
): readonly PermissionKey[] | undefined {
    const declared = RESOURCE_PERMISSIONS[resource];

    if (declared) {
        return declared[action];
    }

    const prefix = CRUD_RESOURCES[resource as CrudResource];

    return prefix ? [`${prefix}.${action}`] : undefined;
}

/**
 * A permission requirement: AND of ORs.
 *
 * Each entry must be satisfied; an entry that is an ARRAY is satisfied by any
 * one of its members. So:
 *
 *     ['role.read']                                  role.read
 *     ['person.read', 'role.read']                   BOTH
 *     [['access_role.manage', 'person_access_role.assign']]   EITHER
 *
 * The two levels are not decoration. A management page's relation picker
 * fetches its options from one or more endpoints, and it may only be offered if
 * EVERY one of them is reachable — while a single endpoint can accept SEVERAL
 * permissions. One level cannot express both, and the version of this that had
 * only the any-of level got the `lecturers` picker wrong: it fetches persons
 * AND roles, so "any of person.read, role.read" would have offered a picker
 * that renders half empty.
 */
export type PermissionRequirement = readonly (string | readonly string[])[];

/** Whether `held` satisfies every clause of `requirement`. */
export function satisfiesPermissionRequirement(
    held: ReadonlySet<string>,
    requirement: PermissionRequirement,
): boolean {
    return requirement.every((clause) => (typeof clause === 'string'
        ? held.has(clause)
        // An EMPTY alternatives array is unsatisfiable, deliberately. It means
        // "one of nothing", and the shape that produces it is a bug in whatever
        // built the requirement — failing closed reports it, failing open hides
        // it behind a control that then 403s.
        : clause.some((permission) => held.has(permission))));
}
