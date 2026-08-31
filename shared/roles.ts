/**
 * The one fixed Role key (TAXONOMY.md §2) — every other role name is tenant
 * vocabulary and must never be hardcoded. Shared because both sides test
 * against it: the client splits lecturers from attendees, and the server
 * resolves the Role row for lecturer assignment, generation materialisation
 * and `lecturerIds` on the wire. A bare `'lecturer'` literal at any of those
 * sites is how one of them ends up disagreeing with the rest.
 */
export const LECTURER_ROLE_KEY = 'lecturer';
