/**
 * The demo institution, taken from real documents rather than invented.
 *
 * WHY REAL DATA MATTERS HERE. Invented demo content agrees with whatever the
 * code already does — a made-up grid is uniform, made-up modules all have the
 * same shape, and made-up groups are a flat pair. None of that exercises the
 * parts of this system that exist because reality is irregular: non-uniform
 * breaks, a seminar that splits a cohort in two, a resit sitting in a teaching
 * week, a Saturday that is a normal teaching day.
 *
 * Sources, both from Leibniz-FH's IT-Security (dual) B.Sc.:
 *
 *   - `Stundenplan_3. Sem. dIT22_S1.xlsx` — a real published timetable. The
 *     block grid, the break structure, the lecturers and the module
 *     abbreviations all come from it.
 *   - `Studienbuch_2022_IT-Security_B.Sc., dual.pdf` — the study book. The
 *     module list, contact hours per semester and assessment types come from
 *     its Modulübersicht.
 *
 * Neither file is committed (`.gitignore` excludes `*.xlsx` / `*.pdf`), so what
 * was read out of them is written down here instead of being re-derivable.
 */

/**
 * The teaching day, read off the timetable's time column.
 *
 * 45-minute blocks from 08:00, and the gaps are NOT uniform — which is the
 * whole reason this is worth copying exactly:
 *
 *     b0   08:00–08:45        break 15
 *     b1   09:00–09:45
 *     b2   09:45–10:30        break 15
 *     b3   10:45–11:30
 *     b4   11:30–12:15        LUNCH 45
 *     b5   13:00–13:45
 *     b6   13:45–14:30        break 15
 *     b7   14:45–15:30
 *     b8   15:30–16:15        break 15
 *     b9   16:30–17:15
 *     b10  17:15–18:00        break 15
 *     b11  18:15–19:00
 *     b12  19:00–19:45
 *
 * `breakMinutes` is 0 BECAUSE the breaks are named. A uniform gap would
 * separate EVERY pair of consecutive blocks, which would make every two-block
 * session break-spanning and turn the break-related rules into noise — see
 * CLAUDE.md § "TimeGrid breaks". Here only five positions carry a gap, and a
 * 90-minute session placed at b1, b3, b5, b7, b9 or b11 spans none of them.
 */
export const GRID = {
    name: 'Standard week',
    blockLengthMinutes: 45,
    blocksPerDay: 13,
    /* Saturday is a real teaching day in the source timetable — ST, IT-Risk and
     * TheoInf all meet on one — so the demo grid includes it rather than
     * assuming the Mon–Fri week most timetables are drawn for. */
    activeDays: [1, 2, 3, 4, 5, 6],
    startHour: 8,
    startMinute: 0,
    breakMinutes: 0,
};

export const BREAKS = [
    { afterBlockIndex: 0, durationMinutes: 15, label: 'Morgenpause' },
    { afterBlockIndex: 2, durationMinutes: 15, label: 'Pause' },
    { afterBlockIndex: 4, durationMinutes: 45, label: 'Mittagspause' },
    { afterBlockIndex: 6, durationMinutes: 15, label: 'Pause' },
    { afterBlockIndex: 8, durationMinutes: 15, label: 'Pause' },
    { afterBlockIndex: 10, durationMinutes: 15, label: 'Pause' },
];

/**
 * Session kinds, and what each one IS.
 *
 * Taken from the study book's `Prüfungsart` column plus what the timetable
 * actually shows, so the EXAM tier has THREE members rather than the single
 * "exam" a made-up vocabulary would produce. That matters: `exam_spacing_*`
 * derives its scope from this classification, and a demo with one exam kind
 * cannot show that the rule covers a set.
 *
 * `NKL` in the source timetable is a Nachklausur — a resit — and it sits in
 * ordinary teaching weeks, not in the exam period. It is the case that makes
 * "exam kind" and "exam week" visibly different things.
 */
export const KINDS = [
    { key: 'lecture', name: 'Vorlesung', color: '#3389C6', type: 'TEACHING' as const, requiresGroup: true },
    { key: 'seminar', name: 'Seminar', color: '#587C58', type: 'TEACHING' as const, requiresGroup: true },
    { key: 'lab', name: 'Praktikum', color: '#4A7B8C', type: 'TEACHING' as const, requiresGroup: true },
    { key: 'project', name: 'Projekt', color: '#7A5EA8', type: 'TEACHING' as const, requiresGroup: true },
    { key: 'language', name: 'Sprachenzentrum', color: '#6B8E9E', type: 'TEACHING' as const, requiresGroup: true },
    { key: 'exam', name: 'Klausur', color: '#A8763E', type: 'EXAM' as const, requiresGroup: true },
    { key: 'resit', name: 'Nachklausur', color: '#B8562F', type: 'EXAM' as const, requiresGroup: true },
    { key: 'presentation', name: 'Vortrag', color: '#96794A', type: 'EXAM' as const, requiresGroup: true },
    /* Ersti-Begrüßung, Science Winter. Carries no group in the source
     * timetable, which is exactly what `requiresGroup: false` is for. */
    { key: 'event', name: 'Veranstaltung', color: '#7E7E7E', type: 'ADMIN' as const, requiresGroup: false },
];

/**
 * The lecturers named in the source timetable, by their abbreviation there.
 *
 * Family names only in the original — given names are invented, since the
 * timetable does not carry them and a Person needs one.
 */
export const LECTURERS = [
    { key: 'lobachev', givenName: 'Oleg', familyName: 'Lobachev' },
    { key: 'arnold', givenName: 'Katrin', familyName: 'Arnold' },
    { key: 'neumann', givenName: 'Bernd', familyName: 'Neumann-Bartsch' },
    { key: 'gareis', givenName: 'Martin', familyName: 'Gareis' },
    { key: 'werner', givenName: 'Sabine', familyName: 'Werner' },
    { key: 'neubauer', givenName: 'Frank', familyName: 'Neubauer' },
    { key: 'witte', givenName: 'Anja', familyName: 'Witte' },
];

/**
 * Semester-1 modules, from the study book's Modulübersicht.
 *
 * `hours` is `Kontaktstunden LFH` — academic hours, which ARE 45 minutes, so
 * they convert to blocks one-for-one. Every module meets in 90-minute slots
 * like the source timetable does, hence `frequency = hours / 2`.
 *
 * `split: true` means the cohort is taught in two halves. The source timetable
 * shows exactly this for `EAC S1-1` / `EAC S1-2`, and it is the reason the S1
 * and S2 groups exist at all: a split module produces one Offering per half,
 * each attended by one of them, and the two must never be placed together.
 */
export const MODULES = [
    { code: 'MAT-101', title: 'Analysis I', hours: 32, kind: 'lecture', lecturer: 'neumann', exam: 'Klausur 120 Min.' },
    { code: 'MAT-102', title: 'Lineare Algebra I', hours: 32, kind: 'lecture', lecturer: 'neumann', exam: 'Klausur 120 Min.' },
    { code: 'ENG-101', title: 'Requirements Engineering und Modellierung', hours: 20, kind: 'lecture', lecturer: 'gareis', exam: 'Klausur 60 Min.' },
    { code: 'INF-101', title: 'Einführung in die Informatik und Digitaltechnik', hours: 28, kind: 'lecture', lecturer: 'werner', exam: 'Klausur 60 Min.' },
    { code: 'INF-102', title: 'Einführung in die objektorientierte Programmierung', hours: 36, kind: 'lab', lecturer: 'arnold', split: true, exam: 'Leistungsnachweis' },
    { code: 'OEK-101', title: 'Allgemeine Betriebswirtschaftslehre', hours: 28, kind: 'lecture', lecturer: 'witte', exam: 'Klausur 120 Min.' },
    { code: 'OEK-102', title: 'Grundlagen der Wertschöpfung', hours: 20, kind: 'lecture', lecturer: 'witte', exam: 'Klausur 120 Min.' },
    { code: 'TEC-101', title: 'Computernetze und Grundlagen des Internet', hours: 28, kind: 'lecture', lecturer: 'lobachev', exam: 'Leistungsnachweis' },
    { code: 'MET-101', title: 'Wissenschaftliches Arbeiten', hours: 8, kind: 'seminar', lecturer: 'werner', split: true, exam: 'Leistungsnachweis' },
    { code: 'PRG-101', title: 'Algorithmen und Datenstrukturen', hours: 32, kind: 'lecture', lecturer: 'neubauer', exam: 'Klausur 60 Min.' },
];

/**
 * Rooms. Capacities are chosen against the group sizes below rather than picked
 * at random: the cohort of 44 fits the lecture hall and the seminar room but
 * not a lab, and each half of 22 fits everything — so room eligibility is a
 * real constraint in the demo rather than one every room satisfies.
 */
export const ROOMS = [
    { code: 'A101', name: 'Hörsaal A', capacity: 120, ranking: 3, location: 'Hauptgebäude' },
    { code: 'A102', name: 'Hörsaal B', capacity: 60, ranking: 2, location: 'Hauptgebäude' },
    { code: 'B204', name: 'Seminarraum B204', capacity: 30, ranking: 1, location: 'Hauptgebäude' },
    { code: 'B205', name: 'Seminarraum B205', capacity: 30, ranking: 1, location: 'Hauptgebäude' },
    { code: 'C012', name: 'Rechnerlabor C012', capacity: 24, ranking: 2, location: 'Technikum' },
    { code: 'C014', name: 'Rechnerlabor C014', capacity: 24, ranking: 2, location: 'Technikum' },
    /* CAPACITY 0 = UNLIMITED, which is what an online room actually is. It also
     * makes the demo exercise that translation rather than describing it: 999
     * was a number chosen to be big, and a group of 1000 would have silently
     * stopped fitting. */
    { code: 'ONLINE', name: 'Online', capacity: 0, ranking: 0, isVirtual: true },
];

/**
 * Six terms, one per semester of the programme.
 *
 * DATES ARE PRESENT-DAY, not the cohort's real 2022–2025 ones, and that is
 * deliberate rather than sloppy: past Sessions are excluded from every solve as
 * a correctness rule, so a demo dated in the past is a demo where the solver
 * has nothing to place. The cohort keeps its real NAME because that is what the
 * groups are called.
 */
export const TERMS = [
    { key: 's1', name: 'Semester 1 (WS 2026/27)', start: '2026-10-05', end: '2027-02-12', exams: ['2027-02-01', '2027-02-12'] },
    { key: 's2', name: 'Semester 2 (SS 2027)', start: '2027-03-01', end: '2027-07-16', exams: ['2027-07-05', '2027-07-16'] },
    { key: 's3', name: 'Semester 3 (WS 2027/28)', start: '2027-10-04', end: '2028-02-11', exams: ['2028-01-31', '2028-02-11'] },
    { key: 's4', name: 'Semester 4 (SS 2028)', start: '2028-03-06', end: '2028-07-14', exams: ['2028-07-03', '2028-07-14'] },
    { key: 's5', name: 'Semester 5 (WS 2028/29)', start: '2028-10-02', end: '2029-02-09', exams: ['2029-01-29', '2029-02-09'] },
    { key: 's6', name: 'Semester 6 (SS 2029)', start: '2029-03-05', end: '2029-07-13', exams: ['2029-07-02', '2029-07-13'] },
];

/**
 * The group tree, as requested, and it is a REAL nesting rather than a flat
 * pair — which is what makes the conflict closure observable: a Session for
 * `dit22 Semester 1` conflicts with one for `… S1`, in both directions,
 * without either naming the other.
 *
 *   IT-Security                    the programme
 *     dit22                        the cohort
 *       dit22 Semester 1           everyone in that semester
 *         dit22 Semester 1 S1      first half
 *         dit22 Semester 1 S2      second half
 */
export const GROUPS = [
    { key: 'programme', name: 'IT-Security', parent: null, expectedSize: 132 },
    { key: 'cohort', name: 'dit22', parent: 'programme', expectedSize: 44 },
    { key: 'semester1', name: 'dit22 Semester 1', parent: 'cohort', expectedSize: 44 },
    { key: 's1', name: 'dit22 Semester 1 S1', parent: 'semester1', expectedSize: 22 },
    { key: 's2', name: 'dit22 Semester 1 S2', parent: 'semester1', expectedSize: 22 },
];

/**
 * Which groups are scoped to which Terms.
 *
 * ONLY THE TWO HALVES ARE SCOPED, and the rest are deliberately left unlinked.
 * `group_term` is fail-open — a Group with no row is available in EVERY Term —
 * so linking every group would say nothing, while linking these two says
 * something checkable: they exist for Semester 1 and nowhere else. It is also
 * the only shape that can catch the trap the table exists to avoid, since
 * adding a row NARROWS rather than widens (CLAUDE.md § "Group↔Term scoping").
 */
export const GROUP_TERMS: { group: string; term: string }[] = [
    { group: 's1', term: 's1' },
    { group: 's2', term: 's1' },
];
