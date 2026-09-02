import { describe, expect, it } from 'vitest';
import {
    EMPTY_ENQUIRY,
    MESSAGE_MAX_LENGTH,
    composeEnquiryMailto,
    enquiryBody,
    enquirySubject,
    validateEnquiry,
} from '../app/utils/landingContact';
import { englishT } from './helpers/landingMessages';

/**
 * The landing page's contact form, tested where its behaviour actually lives.
 *
 * The component owns two things: the draft refs and the one line that assigns
 * `location.href`. Everything that can be WRONG lives in the pure module:
 * which fields are required, what the mail draft contains, and how it is
 * encoded. This suite needs no DOM and no server, which is why it can assert
 * the encoding character by character rather than checking that a form
 * "submitted".
 *
 * The falsification case matters most: a validator that accepted everything
 * would pass a suite made only of valid drafts, and a mailto composed from a
 * blank draft is a mail nobody can answer.
 *
 * WHY THE TRANSLATOR IS `englishT` AND NOT `(key) => key`. Issue #19 moved the
 * validation messages and the mail draft's prose into
 * `i18n/locales/en/landing.json`, and every function here now takes a `t`. The
 * identity stub the conventions recommend is right for a suite measuring
 * structure and would destroy this one: it asserts the composed subject line,
 * the body's exact bytes and the URL encoding character by character, which is
 * the whole reason the rules live in a pure module. Resolving the real English
 * messages keeps all of that, and additionally proves the catalogue carries
 * every key this module asks for. See `tests/helpers/landingMessages.ts`.
 */
const VALID = {
    name: 'Nele Ostermann',
    institution: 'Fachhochschule Nord',
    message: 'We run 40 rooms and 18 cohorts.',
};

describe('validateEnquiry', () => {
    it('accepts a complete enquiry', () => {
        const result = validateEnquiry(VALID, englishT);

        expect(result.valid).toBe(true);
        expect(result.errors).toEqual({});
    });

    it('accepts an enquiry with no message, since the message is optional', () => {
        expect(validateEnquiry({ ...VALID, message: '' }, englishT).valid).toBe(true);
    });

    it('rejects an empty draft, naming BOTH missing fields at once', () => {
        const result = validateEnquiry(EMPTY_ENQUIRY, englishT);

        // Both, not the first: a form that reveals one problem per attempt makes
        // the visitor submit repeatedly to discover what it wants.
        expect(result.valid).toBe(false);
        expect(result.errors.name).toBeTruthy();
        expect(result.errors.institution).toBeTruthy();
        expect(result.errors.message).toBeUndefined();
    });

    it.each([
        ['name', { ...VALID, name: '   ' }],
        ['institution', { ...VALID, institution: '\t\n ' }],
    ])('treats whitespace-only %s as missing', (field, draft) => {
        const result = validateEnquiry(draft, englishT);

        expect(result.valid).toBe(false);
        expect(result.errors[field as 'name' | 'institution']).toBeTruthy();
    });

    it('rejects a message past the length a mailto URL can carry', () => {
        const result = validateEnquiry({ ...VALID, message: 'x'.repeat(MESSAGE_MAX_LENGTH + 1) }, englishT);

        expect(result.valid).toBe(false);
        expect(result.errors.message).toContain(String(MESSAGE_MAX_LENGTH));
    });

    it('accepts a message exactly at the limit', () => {
        expect(validateEnquiry({ ...VALID, message: 'x'.repeat(MESSAGE_MAX_LENGTH) }, englishT).valid).toBe(true);
    });
});

/**
 * A fixture address, deliberately not the real one: `composeEnquiryMailto` takes
 * the mailbox as an argument, and a test that passed the production constant
 * would still pass if the function ignored the argument and hardcoded it.
 */
const TO = 'timetable@example.edu';

describe('the composed mail draft', () => {
    it('names the institution in the subject', () => {
        expect(enquirySubject(VALID, englishT)).toBe('Calendry enquiry: Fachhochschule Nord');
    });

    it('repeats name and institution in the body, so a reply chain keeps them', () => {
        const body = enquiryBody(VALID, englishT);

        expect(body).toContain('Name: Nele Ostermann');
        expect(body).toContain('Institution: Fachhochschule Nord');
        expect(body).toContain('We run 40 rooms and 18 cohorts.');
    });

    it('trims the fields it copies', () => {
        const body = enquiryBody({ name: '  Ada  ', institution: ' Uni ', message: '  hello  ' }, englishT);

        expect(body).toContain('Name: Ada');
        expect(body).toContain('Institution: Uni');
        expect(body.endsWith('hello')).toBe(true);
    });

    it('omits the message block entirely when there is no message', () => {
        const body = enquiryBody({ ...VALID, message: '   ' }, englishT);

        expect(body).toBe('Name: Nele Ostermann\nInstitution: Fachhochschule Nord');
    });

    it('addresses the mailto and encodes both parameters', () => {
        const url = composeEnquiryMailto(VALID, TO, englishT);

        expect(url.startsWith(`mailto:${TO}?`)).toBe(true);
        expect(url).toContain('subject=Calendry%20enquiry');
        expect(url).toContain('body=Name%3A%20Nele%20Ostermann');
    });

    it('encodes a space as %20, never as +', () => {
        // URLSearchParams would produce `+` here, which several mail clients
        // render literally in the subject line. This is the reason the module
        // uses encodeURIComponent instead.
        const url = composeEnquiryMailto(VALID, TO, englishT);

        expect(url).not.toContain('+');
    });

    it('encodes the characters that would otherwise break out of the URL', () => {
        const url = composeEnquiryMailto(
            { name: 'A&B', institution: 'C?D', message: 'line one\nline two #2' },
            TO,
            englishT,
        );

        expect(url).toContain('A%26B');
        expect(url).toContain('C%3FD');
        expect(url).toContain('%0Aline%20two%20%232');
        // One '?' only: the parameter separator itself.
        expect(url.split('?')).toHaveLength(2);
    });

    it('refuses to compose a draft from an invalid enquiry', () => {
        // Failing loudly rather than opening a mail addressed by nobody: a
        // caller that skipped validation is a bug, and a half-empty draft
        // arriving in someone's outbox is how it would otherwise hide.
        expect(() => composeEnquiryMailto(EMPTY_ENQUIRY, TO, englishT)).toThrow();
    });
});
