<template>
    <div class="contact">
        <form
            class="contact_form"
            novalidate
            @submit.prevent="submit"
        >
            <common-input-text
                v-model="draft.name"
                placeholder="Given and family name"
                :input-attrs="{
                    autocomplete: 'name',
                    'aria-invalid': errors.name ? 'true' : 'false',
                    'aria-describedby': errors.name ? 'contact-error-name' : undefined,
                }"
            >Your name</common-input-text>
            <p
                v-if="errors.name"
                id="contact-error-name"
                class="contact_error"
                role="alert"
            >{{ errors.name }}</p>

            <common-input-text
                v-model="draft.institution"
                placeholder="School, university or consortium"
                :input-attrs="{
                    autocomplete: 'organization',
                    'aria-invalid': errors.institution ? 'true' : 'false',
                    'aria-describedby': errors.institution ? 'contact-error-institution' : undefined,
                }"
            >Institution</common-input-text>
            <p
                v-if="errors.institution"
                id="contact-error-institution"
                class="contact_error"
                role="alert"
            >{{ errors.institution }}</p>

            <label class="contact_field">
                <span class="contact_label">What would you like to know? <span class="contact_optional">optional</span></span>
                <textarea
                    v-model="draft.message"
                    class="contact_textarea"
                    rows="4"
                    :maxlength="MESSAGE_MAX_LENGTH"
                    placeholder="How many rooms, how many cohorts, what you use today…"
                    :aria-invalid="errors.message ? 'true' : 'false'"
                    :aria-describedby="errors.message ? 'contact-error-message' : undefined"
                />
            </label>
            <p
                v-if="errors.message"
                id="contact-error-message"
                class="contact_error"
                role="alert"
            >{{ errors.message }}</p>

            <common-button
                native-type="submit"
                type="primary"
            >Open an email to us</common-button>

            <p
                v-if="opened"
                class="contact_status"
                role="status"
            >
                A draft should have opened in your email app, addressed to
                {{ CONTACT_EMAIL }}. If nothing happened, your browser has no mail app
                configured — write to us directly instead.
            </p>
        </form>

        <aside class="contact_aside">
            <h3 class="contact_asideTitle">Why this is an email and not a sign-up form</h3>
            <p class="contact_asideBody">
                There is no self-service sign-up, and Calendry cannot send mail yet — notification
                delivery is on the list above, not behind us. A form that showed you a tick and
                filed your message nowhere would be worse than saying so, so this button composes
                a message in your own email app and you send it from your own account.
            </p>
            <p class="contact_asideBody">
                Or write to <a
                    class="contact_link"
                    :href="`mailto:${ CONTACT_EMAIL }`"
                >{{ CONTACT_EMAIL }}</a>. Accounts for an existing institution are created by its
                administrator.
            </p>
        </aside>
    </div>
</template>

<script setup lang="ts">
import { CONTACT_EMAIL } from '~/utils/landingContent';
import {
    EMPTY_ENQUIRY,
    type EnquiryDraft,
    type EnquiryField,
    MESSAGE_MAX_LENGTH,
    composeEnquiryMailto,
    validateEnquiry,
} from '~/utils/landingContact';

/**
 * The CTA: a real mail draft, not a fake submit.
 *
 * The rules live in `~/utils/landingContact` as pure functions so they can be
 * tested without a DOM; this component owns exactly two things the module
 * cannot — the draft state, and the one line that navigates to the composed
 * `mailto:`. See that module's header for why a POST endpoint would have been
 * the dishonest option here.
 */
const draft = ref<EnquiryDraft>({ ...EMPTY_ENQUIRY });
const errors = ref<Partial<Record<EnquiryField, string>>>({});
const opened = ref(false);

function submit() {
    const validation = validateEnquiry(draft.value);

    errors.value = validation.errors;

    if (!validation.valid) {
        // Never claim success over a refused submit — the previous status line
        // has to go, or a second attempt reads as though it worked.
        opened.value = false;

        return;
    }

    // Assigning `location.href` to a `mailto:` hands the request to the OS
    // handler and leaves the page where it is, so nothing needs restoring
    // afterwards. It is also why this cannot be verified from here: the browser
    // reports neither success nor failure, which is what the status line below
    // says out loud rather than asserting delivery.
    window.location.href = composeEnquiryMailto(draft.value, CONTACT_EMAIL);
    opened.value = true;
}
</script>

<style scoped lang="scss">
.contact {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: $space8;
    align-items: start;

    @include mobile {
        grid-template-columns: minmax(0, 1fr);
        gap: $space7;
    }

    &_form {
        display: flex;
        flex-direction: column;
        gap: $space5;

        max-width: 420px;
        padding: $space7;
        border: 1px solid $surface5;
        border-radius: $radiusXl;

        background: $surface0;
    }

    &_field {
        display: flex;
        flex-direction: column;
        gap: $space4;
    }

    &_label {
        font-size: $fontSizeMd;
        font-weight: 600;
        color: $content4;
    }

    &_optional {
        font-size: $fontSizeXs;
        font-weight: 400;
        color: $content7;
    }

    &_textarea {
        resize: vertical;
        // Matches CommonInputText's field treatment: the shared component has no
        // multi-line variant, and a textarea styled differently from the inputs
        // beside it reads as a different kind of control.
        width: 100%;
        padding: $space5 $space6;
        border: 2px solid transparent;
        border-radius: $radiusLg;

        font-family: $defaultFont;
        font-size: $fontSizeMd;
        font-weight: 600;
        color: $content4;

        background: $surface2;
        outline: none;

        transition: 0.3s;

        &::placeholder {
            color: varToRgba('content4', 0.5);
            opacity: 1;
        }

        &:focus {
            border-color: $primary500;
        }
    }

    &_error {
        margin: 0;
        font-size: $fontSizeSm;
        line-height: 1.5;
        color: $error400;
    }

    &_status {
        margin: 0;
        font-size: $fontSizeSm;
        line-height: 1.6;
        color: $success600;
    }

    &_aside {
        max-width: 56ch;
    }

    &_asideTitle {
        margin: 0 0 $space5;
        font-size: $fontSizeMd;
        font-weight: 700;
        color: $content2;
    }

    &_asideBody {
        margin: 0 0 $space5;
        font-size: $fontSizeSm;
        line-height: 1.7;
        color: $content6;

        &:last-child {
            margin-bottom: 0;
        }
    }

    &_link {
        color: $primary600;
        text-decoration: underline;
    }
}
</style>
