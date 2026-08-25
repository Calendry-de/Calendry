/**
 * The landing page's contact form logic: validation, and composing the mail
 * draft it hands to the visitor's own mail client.
 *
 * WHY A MAIL DRAFT AND NOT A POST ENDPOINT
 *
 * This app has no notification delivery — `BACKLOG.md` § "Import / Export /
 * Notifications" says so, and it is on the landing page's own roadmap. An
 * endpoint that accepted an enquiry today could only log it to stdout and
 * return 200, which is the exact failure this project keeps writing rules
 * against: a success message over a write nobody receives, indistinguishable
 * from a working contact form. Storing it instead would mean a public,
 * unauthenticated write into a tenant-scoped database — a fourth RLS-bypassing
 * path, which CLAUDE.md forbids without a far stronger reason than a contact
 * form.
 *
 * A `mailto:` draft is honest: the mail is composed by the visitor and sent
 * from their own account, so either it is genuinely delivered or they can see
 * that nothing opened. The one failure mode — no mail client configured — is
 * why the component also shows the address as selectable text.
 *
 * Pure functions on purpose. Nothing here touches `window`, so the rules can be
 * tested without a DOM (`tests/landing-contact.test.ts`); the component owns the
 * one line that navigates.
 */

export interface EnquiryDraft {
    name: string;
    institution: string;
    message: string;
}

export type EnquiryField = keyof EnquiryDraft;

export interface EnquiryValidation {
    valid: boolean;
    /** Present only for fields that are actually wrong, so `errors[field]` gates rendering. */
    errors: Partial<Record<EnquiryField, string>>;
}

export const EMPTY_ENQUIRY: EnquiryDraft = { name: '', institution: '', message: '' };

/**
 * A mail draft has to fit in a URL, and browsers differ on where they truncate
 * one. 2,000 characters is comfortably inside every limit worth caring about,
 * and long enough that nobody writing a genuine first enquiry will hit it.
 */
export const MESSAGE_MAX_LENGTH = 2000;

/**
 * Name and institution are required; the message is not.
 *
 * The asymmetry is deliberate. Those two are what make an enquiry answerable,
 * and they are one field each. The message is going to open in a mail client
 * where the visitor can keep writing anyway, so demanding it here would refuse
 * to open a draft for someone who intended to write the whole thing there.
 */
export function validateEnquiry(draft: EnquiryDraft): EnquiryValidation {
    const errors: Partial<Record<EnquiryField, string>> = {};

    if (draft.name.trim() === '') {
        errors.name = 'Tell us who you are, so a reply has somewhere to go.';
    }

    if (draft.institution.trim() === '') {
        errors.institution = 'Which school or university are you asking about?';
    }

    if (draft.message.length > MESSAGE_MAX_LENGTH) {
        errors.message = `Keep this under ${MESSAGE_MAX_LENGTH} characters — the rest can go in the email itself.`;
    }

    return { valid: Object.keys(errors).length === 0, errors };
}

/** The subject line, so the inbox side reads as one recognisable thread. */
export function enquirySubject(draft: EnquiryDraft): string {
    const institution = draft.institution.trim();

    return institution === '' ? 'Calendry enquiry' : `Calendry enquiry — ${institution}`;
}

/**
 * The mail body.
 *
 * Repeating the name and institution inside the body rather than relying on the
 * subject is deliberate: a reply chain outlives its subject line, and the
 * message is the part a human reads first.
 */
export function enquiryBody(draft: EnquiryDraft): string {
    const lines = [
        `Name: ${draft.name.trim()}`,
        `Institution: ${draft.institution.trim()}`,
    ];

    const message = draft.message.trim();

    if (message !== '') {
        lines.push('', message);
    }

    return lines.join('\n');
}

/**
 * A `mailto:` URL for this draft.
 *
 * `encodeURIComponent` rather than `URLSearchParams`: the latter encodes spaces
 * as `+`, which several mail clients render literally in a subject line.
 * Throws on an invalid draft rather than composing a half-empty mail, so a
 * caller that skipped validation fails loudly instead of opening a draft
 * addressed by nobody.
 */
export function composeEnquiryMailto(draft: EnquiryDraft, to: string): string {
    if (!validateEnquiry(draft).valid) {
        throw new Error('Refusing to compose a mail draft from an invalid enquiry.');
    }

    const subject = encodeURIComponent(enquirySubject(draft));
    const body = encodeURIComponent(enquiryBody(draft));

    return `mailto:${to}?subject=${subject}&body=${body}`;
}
