/**
 * The demo institution, taken from real documents rather than invented.
 *
 * WHY REAL DATA MATTERS HERE. Invented demo content agrees with whatever the
 * code already does: a made-up grid is uniform, made-up modules all have the
 * same shape, and made-up groups are a flat pair. None of that exercises the
 * parts of this system that exist because reality is irregular: non-uniform
 * breaks, a seminar that splits a cohort in two, a resit sitting in a teaching
 * week, a Saturday that is a normal teaching day.
 *
 * Sources, both from Leibniz-FH's IT-Security (dual) B.Sc.:
 *
 *   - `Stundenplan_3. Sem. dIT22_S1.xlsx`, a real published timetable. The
 *     block grid, the break structure, the lecturers and the module
 *     abbreviations all come from it.
 *   - `Studienbuch_2022_IT-Security_B.Sc., dual.pdf`, the study book. The
 *     module list, contact hours per semester and assessment types come from
 *     its Modulübersicht.
 *
 * Neither file is committed (`.gitignore` excludes `*.xlsx` / `*.pdf`), so what
 * was read out of them is written down here instead of being re-derivable.
 */

/**
 * The teaching day, read off the timetable's time column.
 *
 * SIX 90-MINUTE BLOCKS FROM 09:00, and the gaps between them are NOT uniform,
 * which is the whole reason this is worth copying exactly:
 *
 *     b0   09:00–10:30        break 15
 *     b1   10:45–12:15        LUNCH 45
 *     b2   13:00–14:30        break 15
 *     b3   14:45–16:15        break 15
 *     b4   16:30–18:00        break 15
 *     b5   18:15–19:45
 *
 * THREE BIG BLOCKS ARE STILL THE SHAPE OF THE DAY, and they are the gaps rather
 * than the blocks: `b0+b1` is the morning (09:00–12:15), `b2+b3` the afternoon
 * (13:00–16:15), `b4+b5` the evening (16:30–19:45): three runs of exactly 195
 * minutes, separated by the one big break and one short one. The source
 * timetable draws those three as single rows. It is modelled at 90 minutes
 * anyway because that is the unit SESSIONS occupy in it: `Stat1` and
 * `EAC S1-1` each fill half an afternoon, not all of it.
 *
 * `breakMinutes` is 0 BECAUSE the breaks are named. A uniform gap would
 * separate EVERY pair of consecutive blocks, which would make every two-block
 * session break-spanning and turn the break-related rules into noise; see
 * CLAUDE.md § "TimeGrid breaks". Here five positions carry a gap and they carry
 * three different lengths, which no uniform value can say.
 *
 * THE 08:00–09:00 ROW IS DROPPED. It is 60 minutes, so no uniform block length
 * can hold it alongside the rest, and it carries one session in twelve weeks of
 * the source timetable. Including it would mean modelling the whole day at 45
 * minutes to accommodate an outlier.
 */
export const GRID = {
    name: 'Standard week',
    blockLengthMinutes: 90,
    blocksPerDay: 6,
    /* Saturday is a real teaching day in the source timetable (ST, IT-Risk and
     * TheoInf all meet on one), so the demo grid includes it rather than
     * assuming the Mon–Fri week most timetables are drawn for. */
    activeDays: [1, 2, 3, 4, 5, 6],
    startHour: 9,
    startMinute: 0,
    breakMinutes: 0,
};

export const BREAKS = [
    { afterBlockIndex: 0, durationMinutes: 15, label: 'Pause' },
    { afterBlockIndex: 1, durationMinutes: 45, label: 'Mittagspause' },
    { afterBlockIndex: 2, durationMinutes: 15, label: 'Pause' },
    { afterBlockIndex: 3, durationMinutes: 15, label: 'Pause' },
    { afterBlockIndex: 4, durationMinutes: 15, label: 'Pause' },
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
 * `NKL` in the source timetable is a Nachklausur (a resit), and it sits in
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
 * Family names only in the original; given names are invented, since the
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
 * All six semesters' modules, from the study book's Modulübersicht, read out
 * by exact PDF word coordinates (not just column-aligned text, which reflows
 * across a page break) and cross-checked against the ten Semester-1 rows this
 * array used to hold alone.
 *
 * `hours` is `Kontaktstunden LFH`, academic hours of 45 minutes. A block is
 * 90, so a block is TWO of them and `frequency = hours / 2`. Every module meets
 * for one block at a time, which is what the source timetable shows: a module
 * fills one row, and a row is 90 minutes.
 *
 * `term` says which Term the Offering runs in. `groups` says who attends,
 * and CARRIES ONE OR TWO ENTRIES ON PURPOSE. TAXONOMY.md § "What attaching
 * several Groups to one Offering MEANS": two-or-more is N INDEPENDENT PARALLEL
 * Session series, one per Group, each getting the full `frequency`, not one
 * shared Session for the union. `['s1', 's2']` is therefore the whole
 * split mechanism: no `-S1`/`-S2` suffix Offering, no second `code`, the app
 * does the splitting. This is a correction from an earlier version of this
 * file, which modelled the two Semester-1 lab modules as two separate
 * Offerings by hand, exactly the union-shaped workaround the taxonomy note
 * exists to retire.
 *
 * `S1`/`S2` ARE A STANDING DIVISION, not a Semester-1-only artefact: the
 * cohort was taught as two halves for nearly every module, all six semesters
 * (first-hand account, not the Studienbuch, which names no groups at all). So
 * `groups: ['s1', 's2']` is the DEFAULT here, not the exception.
 *
 * SEMESTERS 4–6 FORK: from module 19 on, the Studienbuch prints two parallel
 * variants, "Vertiefung Systemtechnik" and "Vertiefung Management", for a
 * few modules per semester, while the rest stay the S1/S2 default. Choosing a
 * Vertiefung RECOMBINED the two halves rather than further splitting them:
 * "S1 and S2 together" in one room per Vertiefung, which is exactly
 * `systemtechnik` / `management` in `GROUPS`: two ordinary top-level Groups
 * built from `s1` + `s2` via `GROUP_SOURCES` (the "Built from other groups"
 * feature), not children of any one semester. A fork module therefore carries
 * `groups: ['systemtechnik']` or `['management']`, ONE group, because the
 * recombination already happened; it does not split again.
 *
 * LECTURERS ARE ASSIGNED, NOT SOURCED: only the Semester-1 Stundenplan names
 * who actually taught it. Semesters 2–6 reuse the same seven people, matched
 * to their existing subject (Neumann keeps every Mathematik/Statistik/theory
 * module, Witte keeps BWL/management/law-adjacent ones, and so on) rather than
 * inventing a bigger faculty.
 *
 * `code` prefixes beyond the original seven (MAT/ENG/INF/OEK/TEC/MET/PRG) are
 * this script's own grouping, not the study book's: STA (Statistik), DAT
 * (Datenbanken), KI (KI/Data Analytics), PMG (the three IT-Projekt-Management
 * modules), SEC (the IT-Security modules common to both Vertiefungen), SYT
 * (Vertiefung Systemtechnik), MGT (Vertiefung Management, plus the
 * management-flavoured common modules), WAR (Digital Wargaming), WPF
 * (Wahlpflichtfach), FOR (Digitale Forensik), THS (the Bachelor modules).
 *
 * `Bachelor-Thesis` carries `hours: 0` IN THE SOURCE: an independent-study
 * module the Studienbuch itself gives no contact hours. Left at 0 rather than
 * invented upward: `frequency = Math.max(1, Math.round(hours / 2))` in
 * `seed-demo-schedule.ts` still floors it to one 90-minute Session, which is
 * the same real-data edge case the dropped 08:00 row and the `NKL` resit were
 * kept for, because a demo built from a real curriculum has quirks a made-up
 * one would not.
 */
export const MODULES = [
    // --- Semester 1 ---
    { code: 'MAT-101', title: 'Analysis I', hours: 32, kind: 'lecture', lecturer: 'neumann', exam: 'Klausur 120 Min.', term: 's1', groups: ['s1', 's2'] },
    { code: 'MAT-102', title: 'Lineare Algebra I', hours: 32, kind: 'lecture', lecturer: 'neumann', exam: 'Klausur 120 Min.', term: 's1', groups: ['s1', 's2'] },
    { code: 'ENG-101', title: 'Requirements Engineering und Modellierung', hours: 20, kind: 'lecture', lecturer: 'gareis', exam: 'Klausur 60 Min.', term: 's1', groups: ['s1', 's2'] },
    { code: 'INF-101', title: 'Einführung in die Informatik und Digitaltechnik', hours: 28, kind: 'lecture', lecturer: 'werner', exam: 'Klausur 60 Min.', term: 's1', groups: ['s1', 's2'] },
    { code: 'INF-102', title: 'Einführung in die objektorientierte Programmierung', hours: 36, kind: 'lab', lecturer: 'arnold', exam: 'Leistungsnachweis', term: 's1', groups: ['s1', 's2'] },
    { code: 'OEK-101', title: 'Allgemeine Betriebswirtschaftslehre', hours: 28, kind: 'lecture', lecturer: 'witte', exam: 'Klausur 120 Min.', term: 's1', groups: ['s1', 's2'] },
    { code: 'OEK-102', title: 'Grundlagen der Wertschöpfung', hours: 20, kind: 'lecture', lecturer: 'witte', exam: 'Klausur 120 Min.', term: 's1', groups: ['s1', 's2'] },
    { code: 'TEC-101', title: 'Computernetze und Grundlagen des Internet', hours: 28, kind: 'lecture', lecturer: 'lobachev', exam: 'Leistungsnachweis', term: 's1', groups: ['s1', 's2'] },
    { code: 'MET-101', title: 'Wissenschaftliches Arbeiten', hours: 8, kind: 'seminar', lecturer: 'werner', exam: 'Leistungsnachweis', term: 's1', groups: ['s1', 's2'] },
    { code: 'PRG-101', title: 'Algorithmen und Datenstrukturen', hours: 32, kind: 'lecture', lecturer: 'neubauer', exam: 'Klausur 60 Min.', term: 's1', groups: ['s1', 's2'] },

    // --- Semester 2 ---
    { code: 'ENG-102', title: 'Software Engineering', hours: 20, kind: 'lecture', lecturer: 'gareis', exam: 'Klausur 60 Min.', term: 's2', groups: ['s1', 's2'] },
    { code: 'TEC-102', title: 'Betriebssysteme', hours: 24, kind: 'lecture', lecturer: 'lobachev', exam: 'Klausur 60 Min.', term: 's2', groups: ['s1', 's2'] },
    { code: 'MET-102', title: 'Hausarbeit', hours: 2, kind: 'seminar', lecturer: 'werner', exam: 'Hausarbeit mit Vortrag', term: 's2', groups: ['s1', 's2'] },
    { code: 'MET-103', title: 'Einstieg in Projektmanagement', hours: 28, kind: 'seminar', lecturer: 'gareis', exam: 'Klausur 60 Min.', term: 's2', groups: ['s1', 's2'] },
    { code: 'PRG-102', title: 'Anwendungen C++', hours: 40, kind: 'lab', lecturer: 'arnold', exam: 'Leistungsnachweis', term: 's2', groups: ['s1', 's2'] },
    { code: 'MAT-103', title: 'Analysis II', hours: 28, kind: 'lecture', lecturer: 'neumann', exam: 'Klausur 120 Min.', term: 's2', groups: ['s1', 's2'] },
    { code: 'MAT-104', title: 'Lineare Algebra II', hours: 28, kind: 'lecture', lecturer: 'neumann', exam: 'Klausur 120 Min.', term: 's2', groups: ['s1', 's2'] },
    { code: 'INF-103', title: 'Komplexität', hours: 24, kind: 'lecture', lecturer: 'neumann', exam: 'Klausur 60 Min.', term: 's2', groups: ['s1', 's2'] },
    { code: 'DAT-101', title: 'Datenorganisation und Datenbanken', hours: 24, kind: 'lecture', lecturer: 'werner', exam: 'Klausur 90 Min.', term: 's2', groups: ['s1', 's2'] },
    { code: 'DAT-102', title: 'Datenmanagement mit SQL', hours: 24, kind: 'lab', lecturer: 'werner', exam: 'Klausur 90 Min.', term: 's2', groups: ['s1', 's2'] },

    // --- Semester 3 ---
    { code: 'INF-104', title: 'Theoretische Informatik', hours: 24, kind: 'lecture', lecturer: 'neumann', exam: 'Klausur 60 Min.', term: 's3', groups: ['s1', 's2'] },
    { code: 'PMG-101', title: 'Management von Projekten', hours: 60, kind: 'project', lecturer: 'gareis', exam: 'Bewertete Gruppenarbeit', term: 's3', groups: ['s1', 's2'] },
    { code: 'STA-101', title: 'Statistik I', hours: 24, kind: 'lecture', lecturer: 'neumann', exam: 'Klausur 60 Min.', term: 's3', groups: ['s1', 's2'] },
    { code: 'MAT-105', title: 'Algebra und Zahlentheorie I', hours: 24, kind: 'lecture', lecturer: 'neumann', exam: 'Klausur 120 Min.', term: 's3', groups: ['s1', 's2'] },
    { code: 'OEK-103', title: 'Kosten- und Leistungsrechnung', hours: 20, kind: 'lecture', lecturer: 'witte', exam: 'Klausur 120 Min.', term: 's3', groups: ['s1', 's2'] },
    { code: 'PRG-103', title: 'Erweiterte Anwendungen C++', hours: 32, kind: 'lab', lecturer: 'arnold', exam: 'Leistungsnachweis', term: 's3', groups: ['s1', 's2'] },
    { code: 'PRG-104', title: 'Softwaretechnik', hours: 24, kind: 'lecture', lecturer: 'arnold', exam: 'Klausur 60 Min.', term: 's3', groups: ['s1', 's2'] },
    { code: 'SEC-101', title: 'Grundlagen IT-Sicherheit', hours: 16, kind: 'lecture', lecturer: 'lobachev', exam: 'Klausur 180 Min.', term: 's3', groups: ['s1', 's2'] },
    { code: 'SEC-102', title: 'IT-Risk', hours: 16, kind: 'lecture', lecturer: 'lobachev', exam: 'Klausur 180 Min.', term: 's3', groups: ['s1', 's2'] },
    { code: 'SEC-103', title: 'Einführung in die Kryptologie', hours: 16, kind: 'lecture', lecturer: 'lobachev', exam: 'Leistungsnachweis', term: 's3', groups: ['s1', 's2'] },
    { code: 'KI-101', title: 'Einführung Artificial Intelligence', hours: 16, kind: 'lecture', lecturer: 'werner', exam: 'Vortrag / (schriftliches) Referat', term: 's3', groups: ['s1', 's2'] },
    { code: 'KI-102', title: 'Big Data Analytics', hours: 24, kind: 'lecture', lecturer: 'werner', exam: 'Vortrag / (schriftliches) Referat', term: 's3', groups: ['s1', 's2'] },

    // --- Semester 4 (common modules stay S1/S2; two fork into the Vertiefung groups) ---
    { code: 'STA-102', title: 'Statistik II', hours: 24, kind: 'lecture', lecturer: 'neumann', exam: 'HA', term: 's4', groups: ['s1', 's2'] },
    { code: 'MAT-106', title: 'Algebra und Zahlentheorie II', hours: 20, kind: 'lecture', lecturer: 'neumann', exam: 'Klausur 120 Min.', term: 's4', groups: ['s1', 's2'] },
    { code: 'OEK-104', title: 'Personalführung', hours: 24, kind: 'lecture', lecturer: 'witte', exam: 'Klausur 120 Min.', term: 's4', groups: ['s1', 's2'] },
    { code: 'SEC-104', title: 'Grundlagen Cloud Computing', hours: 16, kind: 'lecture', lecturer: 'lobachev', exam: 'Leistungsnachweis', term: 's4', groups: ['s1', 's2'] },
    { code: 'PMG-102', title: 'Projektrealisierung mit Kooperations-Partnern', hours: 60, kind: 'project', lecturer: 'gareis', exam: 'Projektdokumentation', term: 's4', groups: ['s1', 's2'] },
    { code: 'SEC-105', title: 'Grundlagen IT-Angriffe und deren Abwehr', hours: 20, kind: 'lecture', lecturer: 'arnold', exam: 'Klausur 90 Min.', term: 's4', groups: ['s1', 's2'] },
    { code: 'SEC-106', title: 'Sichere Software', hours: 28, kind: 'lecture', lecturer: 'arnold', exam: 'Klausur 90 Min.', term: 's4', groups: ['s1', 's2'] },
    { code: 'MGT-101', title: 'IT-Governance and Compliance', hours: 24, kind: 'lecture', lecturer: 'witte', exam: 'Klausur 60 Min.', term: 's4', groups: ['s1', 's2'] },
    // Vertiefung Systemtechnik: "Cloud Sicherheit"
    { code: 'SYT-101', title: 'Anwendung Cloud Computing', hours: 20, kind: 'lecture', lecturer: 'lobachev', exam: 'Klausur 120 Min.', term: 's4', groups: ['systemtechnik'] },
    { code: 'SYT-102', title: 'Kryptographie', hours: 20, kind: 'lecture', lecturer: 'lobachev', exam: 'Klausur 120 Min.', term: 's4', groups: ['systemtechnik'] },
    // Vertiefung Management: "IT-Prozess Management"
    { code: 'MGT-102', title: 'IT-Security-Management', hours: 24, kind: 'lecture', lecturer: 'gareis', exam: 'Klausur 60 Min.', term: 's4', groups: ['management'] },
    { code: 'MGT-103', title: 'ITIL', hours: 20, kind: 'lecture', lecturer: 'gareis', exam: 'Leistungsnachweis', term: 's4', groups: ['management'] },

    // --- Semester 5 (common modules stay S1/S2; two fork into the Vertiefung groups) ---
    { code: 'FOR-101', title: 'Forensik', hours: 32, kind: 'lecture', lecturer: 'witte', exam: 'Klausur 120 Min.', term: 's5', groups: ['s1', 's2'] },
    { code: 'FOR-102', title: 'IT-Recht und IT-Sicherheitsrecht', hours: 16, kind: 'lecture', lecturer: 'witte', exam: 'Klausur 120 Min.', term: 's5', groups: ['s1', 's2'] },
    { code: 'MGT-104', title: 'Hausarbeit zu Management fokussierten Themen', hours: 2, kind: 'seminar', lecturer: 'witte', exam: 'Hausarbeit mit Vortrag', term: 's5', groups: ['s1', 's2'] },
    { code: 'PMG-103', title: 'Projektrealisierung und Ergebnispräsentation', hours: 60, kind: 'project', lecturer: 'gareis', exam: 'Projektdoku. und -präsentation', term: 's5', groups: ['s1', 's2'] },
    { code: 'WAR-101', title: 'Praktische IT-Angriffe und deren Abwehr', hours: 36, kind: 'project', lecturer: 'arnold', exam: 'Bewertete Gruppenarbeit', term: 's5', groups: ['s1', 's2'] },
    { code: 'WPF-101', title: 'Wahlpflichtfach I', hours: 60, kind: 'seminar', lecturer: 'werner', exam: 'vers. Prüfungsleistungen', term: 's5', groups: ['s1', 's2'] },
    // Vertiefung Systemtechnik: "Kryptoanalyse"
    { code: 'SYT-103', title: 'Kryptoanalyse I', hours: 20, kind: 'lecture', lecturer: 'lobachev', exam: 'Klausur 60 Min.', term: 's5', groups: ['systemtechnik'] },
    { code: 'SYT-104', title: 'Kryptoanalyse II', hours: 20, kind: 'lecture', lecturer: 'lobachev', exam: 'Bewertete Gruppenarbeit', term: 's5', groups: ['systemtechnik'] },
    // Vertiefung Management: "Security Engineering"
    { code: 'MGT-105', title: 'Social Engineering', hours: 20, kind: 'lecture', lecturer: 'witte', exam: 'Klausur 120 Min.', term: 's5', groups: ['management'] },
    { code: 'MGT-106', title: 'Grundlagen Mobiler Software', hours: 20, kind: 'lecture', lecturer: 'witte', exam: 'Klausur 120 Min.', term: 's5', groups: ['management'] },

    // --- Semester 6 (common modules stay S1/S2; two fork into the Vertiefung groups) ---
    { code: 'WAR-102', title: 'Erweiterte IT-Angriffe und proaktive Abwehr', hours: 36, kind: 'project', lecturer: 'arnold', exam: 'Bewertete Gruppenarbeit mit Präs.', term: 's6', groups: ['s1', 's2'] },
    { code: 'WPF-102', title: 'Wahlpflichtfach II', hours: 60, kind: 'seminar', lecturer: 'werner', exam: 'vers. Prüfungsleistungen', term: 's6', groups: ['s1', 's2'] },
    { code: 'THS-101', title: 'Bachelor-Thesis', hours: 0, kind: 'project', lecturer: 'gareis', exam: 'Bachelor-Thesis', term: 's6', groups: ['s1', 's2'] },
    { code: 'THS-102', title: 'Bachelor-Kolloquium', hours: 2, kind: 'presentation', lecturer: 'gareis', exam: 'Kolloquium', term: 's6', groups: ['s1', 's2'] },
    // Vertiefung Systemtechnik: "Mobile Systems"
    { code: 'SYT-105', title: 'Field Communications', hours: 24, kind: 'lecture', lecturer: 'lobachev', exam: 'Leistungsnachweis', term: 's6', groups: ['systemtechnik'] },
    { code: 'SYT-106', title: 'Entwicklung der Mobilen Software', hours: 20, kind: 'lab', lecturer: 'arnold', exam: 'Klausur 60 Min.', term: 's6', groups: ['systemtechnik'] },
    // Vertiefung Management: "Security Management"
    { code: 'MGT-107', title: 'Computational Trust', hours: 24, kind: 'lecture', lecturer: 'witte', exam: 'Klausur 120 Min.', term: 's6', groups: ['management'] },
    { code: 'MGT-108', title: 'Responsibility', hours: 16, kind: 'lecture', lecturer: 'witte', exam: 'Klausur 120 Min.', term: 's6', groups: ['management'] },
];

/**
 * Rooms. Capacities are chosen against the group sizes below rather than picked
 * at random: the cohort of 44 fits the lecture hall and the seminar room but
 * not a lab, and each half of 22 fits everything, so room eligibility is a
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
 * The group tree, flatter than an earlier version of this file had it, and
 * deliberately so. `s1`/`s2` are a STANDING division of the cohort (see
 * `MODULES`), not a Semester-1 artefact, so they sit directly under `cohort`
 * rather than nested under one semester: nesting them under `semester1`
 * would have made a Semester-4 Session in `s1` fail to conflict-closure
 * against a Semester-4 Session in `cohort`'s other children, since closure
 * walks ancestors/descendants, not siblings. "Which semester" is the
 * Offering's `term`, not a Group; this tree has no `semesterN` nodes at all.
 *
 *   IT-Security          the programme
 *     dit22               the cohort (44)
 *       S1                one standing half (22), taught separately
 *       S2                the other standing half (22)
 *       Systemtechnik      (22), built from S1 + S2, see GROUP_SOURCES
 *       Management         (22), built from S1 + S2, see GROUP_SOURCES
 *
 * `Systemtechnik`/`Management` are `parent: null` (root-level, like `cohort`
 * itself) for the reason TAXONOMY.md gives for "Built from other groups":
 * a combining group is an ordinary Group with its own membership, not a
 * second parent; nesting it under both `s1` and `s2` would make the tree a
 * DAG, which the closure walk cannot be.
 */
export const GROUPS = [
    { key: 'programme', name: 'IT-Security', parent: null, expectedSize: 132 },
    { key: 'cohort', name: 'dit22', parent: 'programme', expectedSize: 44 },
    { key: 's1', name: 'dit22 S1', parent: 'cohort', expectedSize: 22 },
    { key: 's2', name: 'dit22 S2', parent: 'cohort', expectedSize: 22 },
    { key: 'systemtechnik', name: 'dit22 Systemtechnik', parent: null, expectedSize: 22 },
    { key: 'management', name: 'dit22 Management', parent: null, expectedSize: 22 },
];

/**
 * `systemtechnik` and `management` are "Built from other groups"
 * (`ManageGroupSources.vue`) rather than plain Groups: each draws its
 * membership from BOTH standing halves, because choosing a Vertiefung
 * recombined S1 and S2 rather than splitting either further. Seeded as
 * `group_source` rows directly: there are no Person-level memberships in
 * this demo to actually copy (no student Persons are seeded, only the seven
 * lecturers), so "regenerate members" would copy zero rows either way; what
 * matters here is the SOURCES relationship existing to see and to build on.
 */
export const GROUP_SOURCES: { group: string; source: string }[] = [
    { group: 'systemtechnik', source: 's1' },
    { group: 'systemtechnik', source: 's2' },
    { group: 'management', source: 's1' },
    { group: 'management', source: 's2' },
];

/**
 * Which groups are scoped to which Terms.
 *
 * `s1`/`s2` ATTACH TO EVERY TERM, because every semester's Offerings use them
 * by default. `systemtechnik`/`management` attach only to the three terms
 * that fork; `group_term` is fail-open (a Group with no row is available in
 * EVERY Term), so linking exactly the terms `MODULES` references for each
 * says something checkable rather than nothing (CLAUDE.md §
 * "Group↔Term scoping").
 */
export const GROUP_TERMS: { group: string; term: string }[] = TERMS.flatMap((term) => [
    { group: 's1', term: term.key },
    { group: 's2', term: term.key },
]).concat(
    ['s4', 's5', 's6'].flatMap((term) => [
        { group: 'systemtechnik', term },
        { group: 'management', term },
    ]),
);
