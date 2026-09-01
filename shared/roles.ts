/**
 * The one fixed Role key (TAXONOMY.md §2) — every other role name is tenant
 * vocabulary and must never be hardcoded. Shared because both sides test
 * against it: the client splits lecturers from attendees, and the server
 * resolves the Role row for lecturer assignment, generation materialisation
 * and `lecturerIds` on the wire. A bare `'lecturer'` literal at any of those
 * sites is how one of them ends up disagreeing with the rest.
 */
export const LECTURER_ROLE_KEY = 'lecturer';

/**
 * Issue #107. Domain vocabulary, alongside `LECTURER_ROLE_KEY` — a Role a
 * Person can be, not an authority they hold. Seeded `isSystem: true` for
 * every NEW tenant by `scripts/provision-tenant.ts`, same as `lecturer`.
 *
 * NOT wired to any permission grant: Role (TAXONOMY.md §2) and AccessRole
 * (§4) are deliberately separate, and this codebase's own rule is "never
 * grant permissions via Role" — a Person who IS a Student gets their
 * schedule-viewing authority from an AccessRole (`member`, or whatever a
 * tenant configures as its default), never from holding this Role.
 */
export const STUDENT_ROLE_KEY = 'student';

/**
 * Issue #107. Same shape and same caveat as `STUDENT_ROLE_KEY` — domain
 * vocabulary only, seeded `isSystem: true` alongside `lecturer` and
 * `student`, carrying no permission of its own.
 */
export const PARENT_ROLE_KEY = 'parent';
