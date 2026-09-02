/**
 * What role a Session kind plays, as opposed to what a tenant calls it.
 *
 * THE FIXED HALF OF AN OPEN VOCABULARY. A kind's `key` and `name` are the
 * tenant's own (`exam`, `Klausur`, `assessment`), and TAXONOMY.md forbids any
 * logic from assuming one of them. That rule was never the problem; the missing
 * piece was a way for a tenant to DECLARE that a kind it named itself is an
 * exam, so a rule can read the declaration rather than guess at the string.
 *
 * WHY IT IS NOT A BOOLEAN. `isExam` would answer one question and force the
 * next distinction to be a second boolean, and two booleans admit a fourth
 * state nobody means. `ADMIN` also exists precisely because a staff meeting is
 * neither an exam nor teaching, and a boolean has nowhere to put it.
 */
export const SESSION_KIND_TYPES = ['TEACHING', 'EXAM', 'ADMIN'] as const;

export type SessionKindType = (typeof SESSION_KIND_TYPES)[number];

export const SESSION_KIND_TYPE_LABELS: Record<SessionKindType, string> = {
    TEACHING: 'Teaching',
    EXAM: 'Exam',
    ADMIN: 'Administrative',
};

/**
 * Deliberately says what each is FOR, not what it is called. The value a
 * tenant picks here decides which rules reach the kind, and "Exam" alone does
 * not tell anyone that.
 */
export const SESSION_KIND_TYPE_HELP: Record<SessionKindType, string> = {
    TEACHING: 'Ordinary taught sessions: lectures, seminars, labs.',
    EXAM: 'Assessments. Exam rules find these by this setting, not by what you '
        + 'named the kind, so “Klausur” works as well as “Exam”.',
    ADMIN: 'Neither taught nor assessed: staff meetings, open days. No rule '
        + 'reads this yet; it records the distinction rather than forcing it '
        + 'into Teaching.',
};
