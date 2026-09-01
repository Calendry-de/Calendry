<template>
    <div class="contact">
        <form
            class="contact_form"
            novalidate
            @submit.prevent="submit"
        >
            <CommonInputText
                v-model="draft.name"
                placeholder="Given and family name"
                :input-attrs="{
                    autocomplete: 'name',
                    'aria-invalid': errors.name ? 'true' : 'false',
                    'aria-describedby': errors.name ? 'contact-error-name' : undefined,
                }"
            >Your name</CommonInputText>
            <p
                v-if="errors.name"
                id="contact-error-name"
                class="contact_error"
                role="alert"
            >
                <Icon
                    class="contact_errorIcon"
                    name="material-symbols:error"
                    aria-hidden="true"
                />
                <span>{{ errors.name }}</span>
            </p>

            <CommonInputText
                v-model="draft.institution"
                placeholder="School, university or consortium"
                :input-attrs="{
                    autocomplete: 'organization',
                    'aria-invalid': errors.institution ? 'true' : 'false',
                    'aria-describedby': errors.institution ? 'contact-error-institution' : undefined,
                }"
            >Institution</CommonInputText>
            <p
                v-if="errors.institution"
                id="contact-error-institution"
                class="contact_error"
                role="alert"
            >
                <Icon
                    class="contact_errorIcon"
                    name="material-symbols:error"
                    aria-hidden="true"
                />
                <span>{{ errors.institution }}</span>
            </p>

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
                <!--
                    `maxlength` stops typing at the cap with no feedback at all,
                    which is a silent truncation of someone's sentence. The count
                    appears once they are close enough for it to matter, so it is
                    not noise on an empty field.
                -->
                <span
                    v-if="showCount"
                    class="contact_count"
                    aria-live="polite"
                >{{ draft.message.length }} / {{ MESSAGE_MAX_LENGTH }}</span>
            </label>
            <p
                v-if="errors.message"
                id="contact-error-message"
                class="contact_error"
                role="alert"
            >
                <Icon
                    class="contact_errorIcon"
                    name="material-symbols:error"
                    aria-hidden="true"
                />
                <span>{{ errors.message }}</span>
            </p>

            <CommonButton
                native-type="submit"
                type="primary"
            >Open an email to us</CommonButton>

            <p
                v-if="opened"
                class="contact_status"
                role="status"
            >
                <Icon
                    class="contact_statusIcon"
                    name="material-symbols:check-circle"
                    aria-hidden="true"
                />
                <span>
                    A draft should have opened in your email app, addressed to
                    {{ CONTACT_EMAIL }}. If nothing happened, your browser has no mail app
                    configured. Write to us directly instead.
                </span>
            </p>
        </form>

        <aside class="contact_aside">
            <h3 class="contact_asideTitle">Why this is an email and not a sign-up form</h3>
            <p class="contact_asideBody">
                There is no self-service sign-up, and Calendry cannot send mail yet: notification
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

/** Within a quarter of the cap is close enough that the number is useful. */
const showCount = computed(() => draft.value.message.length > MESSAGE_MAX_LENGTH * 0.75);

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
    grid-template-columns: minmax(320px, 5fr) minmax(0, 6fr);
    gap: $space9;
    align-items: start;

    @include mobile {
        grid-template-columns: minmax(0, 1fr);
        gap: $space8;
    }

    &_form {
        display: flex;
        flex-direction: column;
        gap: $space5;

        // No max-width: it was 420px inside a ~488px column, which left a dead
        // gutter that appeared nowhere else on the page. The column governs.
        padding: $space7;
        border: 1px solid $surface5;
        border-radius: $radiusXl;

        // One step up from the page ground rather than the invisible 1.04:1
        // `$surface0`. This is the only real panel on the page, and it is the
        // one place a panel earns its edges.
        background: $surface2;

        @include mobileOnly {
            padding: $space6;
        }
    }

    /*
     * iOS Safari zooms the viewport when a focused field is under 16px, so a
     * one-handed reader ends up zoomed and pannning mid-form. `CommonInputText`
     * drops to 10px under 1365px — below the type scale's own floor — which is
     * a defect in the shared component; overriding it here fixes this form
     * without restyling every form in the product in a landing-page change.
     */
    &_form :deep(.input__input input),
    &_textarea {
        font-size: var(--font-size-lg);
    }

    &_form :deep(.input_label) {
        font-size: $fontSizeMd;
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
        font-weight: 600;
        color: $content4;

        background: $surface0;
        outline: none;

        transition: border-color 160ms cubic-bezier(0.16, 1, 0.3, 1);

        &::placeholder {
            // 0.5 alpha measured 2.87:1 against the field. This reads at AA
            // while still sitting clearly behind real input.
            color: varToRgba('content4', 0.72);
            opacity: 1;
        }

        &:focus-visible {
            border-color: $primary500;
            outline: none;
        }
    }

    &_count {
        font-size: $fontSizeXs;
        font-variant-numeric: tabular-nums;
        color: $content7;
        text-align: right;
    }

    /*
     * INK TEXT, ERROR-COLOURED ICON — and this is a palette fact, not a
     * preference. Only the two NEUTRAL ramps swap between themes; the semantic
     * ramps hold one value for both. Measured against this field surface, no
     * step of the error ramp clears 4.5:1 in both themes at once — `$error700`
     * is 5.71:1 light and 2.44:1 dark, `$error300` is 2.40:1 light and 5.79:1
     * dark, and the middle fails everywhere. `$error500` is the one step that
     * clears the 3:1 NON-TEXT threshold on both grounds (3.83 / 3.63), so the
     * colour goes on the glyph and the sentence is read in ink at 12:1.
     *
     * It is also the pattern the schedule already uses for violations: icon,
     * plus text, plus a screen-reader path — never hue alone.
     */
    &_error {
        display: flex;
        gap: $space4;
        align-items: start;

        margin: 0;

        font-size: $fontSizeSm;
        line-height: 1.5;
        color: $content4;
    }

    &_errorIcon {
        flex: none;

        width: $space6;
        height: $space6;
        margin-top: $space1;

        color: $error500;
    }

    &_status {
        display: flex;
        gap: $space4;
        align-items: start;

        margin: 0;

        // NOT green. The whole success ramp is too light for a light ground —
        // $success600 measured 2.53:1 as text — and green is not a state colour
        // in this product's palette at all. The check glyph carries "it worked";
        // ink carries the reading.
        font-size: $fontSizeSm;
        line-height: 1.6;
        color: $content4;
    }

    &_statusIcon {
        flex: none;

        width: $space6;
        height: $space6;
        margin-top: $space1;
        // Inherits the ink colour deliberately: the success ramp fails on a
        // light ground at every step, and a check glyph does not need a hue to
        // be read as a check.
        color: $content4;
    }

    &_aside {
        max-width: 58ch;
    }

    &_asideTitle {
        margin: 0 0 $space5;
        font-size: $fontSizeMd;
        font-weight: 700;
        color: $content2;
    }

    &_asideBody {
        margin: 0 0 $space5;
        font-size: $fontSizeMd;
        line-height: 1.75;
        color: $content6;

        &:last-child {
            margin-bottom: 0;
        }
    }

    &_link {
        // Ink plus an underline, never the accent. `$primary600` passes on the
        // light ground and measures 2.55:1 on the dark one, because the dark
        // theme swaps only the surface and content ramps — so accent-coloured
        // TEXT cannot be made safe in both themes. The accent stays on fills
        // and the placement target, where it means something.
        color: $content4;
        text-decoration: underline;
        text-underline-offset: 2px;
    }
}
</style>
