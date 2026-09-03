<template>
    <component
        :is="getTag"
        class="button"
        :class="[
            `button--type-${ type }`,
            `button--size-${ size }`,
            `button--orientation-${ orientation }`,
            {
                'button--disabled': disabled,
                'button--icon': !!$slots.icon && !$slots.default,
            },
        ]"
        :style="{
            '--button-width': width ?? 'auto',
            '--icon-width': iconWidth,
            '--primary-color': primaryColor ? colorsList[primaryColor] : null,
            '--link-color': linkColor ? colorsList[linkColor] : null,
            '--hover-color': hoverColor ? colorsList[hoverColor] : null,
            '--focus-color': focusColor ? colorsList[focusColor] : null,
        }"
        :target="target"
        v-bind="getAttrs"
        @click="!disabled && $emit('click', $event)"
    >
        <div
            v-if="$slots.icon"
            class="button_icon"
        >
            <slot name="icon"/>
        </div>
        <span
            v-if="$slots.default"
            class="button_content"
        >
            <slot name="default"/>
        </span>
        <div
            v-if="$slots.append"
            class="button_append"
        >
            <slot name="append"/>
        </div>
    </component>
</template>

<script setup lang="ts">
import type { PropType, VNode } from 'vue';
// The label wrapper was <ui-text type="2b">, but no UiText component exists in
// this repo; it was never ported from the source template, so Vue could not
// resolve it and logged a warning for every button with a label. Styling is
// keyed on the .button_content class rather than the tag, so a span is a
// drop-in replacement. Restore a typography component here if one is added.
import type { RouteLocationRaw } from 'vue-router';
import { NuxtLink } from '#components';
import type { ColorsList } from '~/utils/styles';
import { colorsList } from '~/utils/styles';

const props = defineProps({
    tag: {
        type: String,
        default: undefined,
    },
    /**
     * The NATIVE button type, distinct from `type`, which is this component's
     * visual variant and was already taken. Defaults to 'button' so a button
     * inside a form does not submit it by accident; the auth forms pass
     * 'submit' deliberately.
     */
    nativeType: {
        type: String as PropType<'button' | 'submit' | 'reset'>,
        default: 'button',
    },
    width: {
        type: String,
        default: undefined,
    },
    iconWidth: {
        type: String,
        default: '16px',
    },
    type: {
        // NOTE: 'secondary-875' is accepted because ViewMenu.vue passes it, but
        // this component has no styles for it, so it renders with an unstyled
        // button--type-secondary-875 class. Either add the SCSS or migrate that
        // caller to an implemented variant. ('transparent' was the other half
        // of this gap and now has styles.)
        // 'outline' is the hairline ghost: a visible control at rest for
        // actions that are neither THE action (primary fill) nor chrome on
        // other content (transparent). 'secondary' has no fill at rest, so a
        // lone "Create…" button drawn with it read as a stray line of text.
        type: String as PropType<'primary' | 'secondary' | 'secondary-black' | 'secondary-875' | 'destructive' | 'link' | 'transparent' | 'outline'>,
        default: 'primary',
    },
    orientation: {
        type: String as PropType<'vertical' | 'horizontal'>,
        default: 'horizontal',
    },
    disabled: {
        type: Boolean,
        default: false,
    },
    size: {
        type: String as PropType<'M' | 'S'>,
        default: 'M',
    },
    href: {
        type: String,
        default: null,
    },
    target: {
        type: String,
        default: null,
    },
    to: {
        type: [String, Object] as PropType<RouteLocationRaw | string | null | undefined>,
        default: null,
    },
    primaryColor: {
        type: String as PropType<ColorsList | null>,
        default: null,
    },
    linkColor: {
        type: String as PropType<ColorsList>,
        default: 'content5',
    },
    hoverColor: {
        type: String as PropType<ColorsList | null>,
        default: null,
    },
    focusColor: {
        type: String as PropType<ColorsList | null>,
        default: null,
    },
    textAlign: {
        type: String,
        default: 'center',
    },
});

defineEmits<{ click: [e: MouseEvent] }>();

defineSlots<{
    default?(): VNode[];
    icon?(): VNode[];
    append?(): VNode[];
}>();

/**
 * A real <button> by default, not a <div>. It rendered a div until now, so every
 * action built on this component was mouse-only: not reachable by Tab, not
 * activated by Enter or Space, not announced as a button. `disabled` gets a real
 * button too, so assistive tech hears "unavailable" instead of nothing.
 */
const getTag = computed(() => {
    if (props.disabled) return props.tag ?? 'button';
    if (props.href) return 'a';
    if (props.to) return NuxtLink;
    return props.tag ?? 'button';
});

/** True only when we actually render a native <button> element. */
const isNativeButton = computed(() => getTag.value === 'button');

const getAttrs = computed(() => {
    const attrs: Record<string, RouteLocationRaw | string | boolean | undefined> = {};
    if (props.to) {
        attrs.to = props.to;
        attrs.noPrefetch = true;
    }
    else if (props.href) attrs.href = props.href;

    if (isNativeButton.value) {
        /**
         * `type` is already this component's VISUAL variant, so the native one
         * needs its own prop. It defaults to "button" because a <button> inside
         * a <form> is a SUBMIT button unless told otherwise, so switching the
         * default tag without this would have turned every button in every form
         * into an accidental submit.
         *
         * The two auth forms opt in with `native-type="submit"`, which is what
         * makes Enter-to-submit work there.
         */
        attrs.type = props.nativeType ?? 'button';
        attrs.disabled = props.disabled || undefined;
    }

    return attrs;
});
</script>

<style scoped lang="scss">
.button {
    --text-primary-color: currentColor;
    cursor: pointer;
    user-select: none;

    display: flex;
    gap: var(--space-5);
    align-items: center;
    justify-content: center;

    width: var(--button-width);
    min-height: 40px;
    padding: 8px 20px; // 20px has no scale match; kept together rather than half-tokenized.
    border: none;
    border-radius: var(--radius-sm);

    /* A native <button> inherits the UA's font, not the page's, so switching
       the root element from <div> would silently restyle every button. The
       styling is otherwise keyed on classes, which is what makes the tag change
       a drop-in. */
    font: inherit;
    color: $typographyPrimary;
    text-align: v-bind(textAlign);
    text-decoration: none;

    appearance: none;
    background: var(--primary-color, $primary500);
    outline: none;
    box-shadow: none;

    /*
     * MUST STAY. `outline: none` above compiles scoped to (0,2,0) and therefore
     * BEATS the global `:focus-visible` rule in layout.scss at (0,1,0), so
     * without this, keyboard focus on any button in the product was invisible
     * except where a variant happened to change its own background. The
     * `--type-primary` focus background lived inside `@include pc`, so on any
     * viewport under 1366px tabbing to a primary action showed nothing at all.
     * Declared here rather than per-variant so a new variant cannot forget it.
     */

    /* Same contrast reasoning as the global rule in layout.scss: $primary400
       measured 2.31:1 against the page ground, under the 3:1 a focus indicator
       needs. This rule exists at all because `outline: none` above outranks the
       global one. */
    &:focus-visible {
        outline: 2px solid $primary600;
        outline-offset: 2px;
    }

    &_content {
        width: 100%;
        min-width: min-content;
    }

    @include pc {
        transition: 0.3s;

        &:hover {
            background: var(--hover-color, $primary400);
        }

        &:focus, &:active {
            background: var(--focus-color, $primary600);
        }
    }

    /*
     * THE LABEL IS INK AND THE STATES GO LIGHTER, which is the reverse of what the
     * purple ramp needed. White measured 5.01:1 on `$primary500` when it was purple;
     * on the teal fill it is only 3.14:1, the same failure the white label was
     * introduced to fix, arriving from the other side. Ink passes instead, and with
     * an ink label the states must move UP the ramp, since darkening now costs
     * contrast:
     *
     *   $content0Orig on $primary500   5.7:1   rest    ✓ AA
     *   $content0Orig on $primary400   7.6:1   hover   ✓ AA
     *   $content0Orig on $primary300  10.4:1   active  ✓ AA
     *
     * `Orig`, not `$content0`: the fill is a fixed brand colour in both themes, so a
     * theme-following label would invert to near-white on teal in dark mode.
     */
    &--type-primary {
        color: $content0Orig;

        @include hover {
            &:hover {
                background: var(--hover-color, $primary400);
            }
        }

        // `:focus` is listed as well as `:focus-visible`: the base rule above
        // sets `:focus` to $primary600, where an ink label is 3.90:1, and it
        // matches at the same specificity. Leaving it out puts the one state a
        // keyboard user sees most below AA.
        &:active, &:focus, &:focus-visible {
            background: var(--focus-color, $primary300);
        }
    }

    &_icon {
        width: var(--icon-width);
        min-width: var(--icon-width);
    }

    &--type-secondary, &--type-destructive {
        background: var(--primary-color, transparent);
    }

    &--type-secondary, &--type-destructive {
        @include hover {
            &:hover {
                background: var(--hover-color, $whiteAlpha4);
            }

            &:active, &:focus {
                background: var(--focus-color, $primary500);
            }
        }
    }

    &--type-secondary-black {
        background: var(--primary-color, $surface6);

        @include hover {
            &:hover {
                background: var(--hover-color, $surface7);
            }

            &:active, &:focus {
                background: var(--focus-color, $content7);
            }
        }
    }

    /**
     * Chrome, not a surface: for controls that sit ON other content, where a filled
     * rest state would read as a panel of its own.
     *
     * It cannot reuse `secondary`: that is `var(--primary-color, transparent)`, so
     * it is only transparent until a caller sets the variable, and its
     * :active/:focus jumps to solid $primary500, so a chevron that flashes solid when
     * clicked reads as a primary action. Unlike `link` it keeps padding, radius and
     * the 40px icon box, so it stays a real hit target.
     */
    &--type-transparent {
        background: transparent;

        /* The base declares backgrounds for rest AND hover/focus/active inside
           `@include pc`, so overriding only the unmediated declaration above
           would leave this variant solid purple on wide viewports, a bug that
           survives review because nobody resizes to 1366px to check a chevron.
           Every state is therefore restated, not just the rest one. */
        @include pc {
            &, &:hover, &:focus, &:active {
                background: transparent;
            }
        }

        /* MUST STAY AFTER THE RESET ABOVE. On a wide pointer device both blocks
           match and both are (0,2,0), so source order alone decides which wins.
           Moving this above the `@include pc` block does not fail loudly: it
           silently removes the hover feedback at >=1366px only. */
        @include hover {
            &:hover {
                background: var(--hover-color, $whiteAlpha4);
            }

            &:active, &:focus {
                background: var(--focus-color, $whiteAlpha8);
            }
        }

        /* `.button` clears the outline globally. On a filled variant the
           background change carries focus on its own; with no fill at rest
           there is nothing left to see, so keyboard focus would be invisible.

           The colour is the GLOBAL ring's (`:focus-visible` in layout.scss), not
           a local choice; only the inset offset is local, because an outward
           ring on a button sitting flush in a toolbar gets clipped. This used to
           say it matched "the ring used across the schedule components", which
           was true and was the problem: those components had each copied
           `$primary400`, the value the global rule was written to eliminate at
           2.31:1. */
        &:focus-visible {
            outline: 2px solid $primary600;
            outline-offset: -2px;
        }
    }

    &--type-destructive .button_content {
        color: $error600;
    }

    /*
     * THE HAIRLINE GHOST: `$surface5` edge, `$surface0` fill, `--radius-md`,
     * the shape the schedule toolbar's toggles and the dashboard's account
     * actions already draw by hand. Every state is restated (as `transparent`
     * does) because the base `@include pc` hover above would otherwise fill
     * it teal on wide viewports.
     */
    &--type-outline {
        gap: var(--space-3);

        padding: var(--space-3) var(--space-6);
        border: 1px solid $surface5;
        border-radius: var(--radius-md);

        font-size: var(--font-size-sm);
        color: $content5;

        background: $surface0;

        transition: border-color 140ms cubic-bezier(0.16, 1, 0.3, 1),
            color 140ms cubic-bezier(0.16, 1, 0.3, 1),
            background 140ms cubic-bezier(0.16, 1, 0.3, 1);

        @include pc {
            &,
            &:hover,
            &:focus,
            &:active {
                background: $surface0;
            }
        }

        @include hover {
            &:hover {
                border-color: $surface6;
                color: $content2;
                background: $surface0;
            }
        }

        &:active,
        &:focus {
            background: $surface2;
        }

        &:focus-visible {
            outline: 2px solid $primary600;
            outline-offset: 1px;
        }

        .button_icon {
            color: $content6;
        }
    }

    &--orientation-vertical {
        flex-direction: column;
        text-align: center;
    }

    &--icon {
        width: 40px;
        height: 40px;
        padding: var(--space-4);
    }

    /*
     * 44px ON A PHONE ONLY: the rule this codebase already applies to every
     * other thumb-reached control (`ScheduleAgenda`'s day tabs,
     * `ScheduleWeekNav`'s steppers, `ScheduleToolbar`'s selects and toggles,
     * `ScheduleFilterPanel`'s close), and which the buttons those controls sit
     * beside were never given. At 40px the default button was the shortest
     * thing in every mobile row it shared.
     *
     * Not raised on desktop: 40px matches the ~34px selects and 35px toggles it
     * lines up with there, and the comment on those rules is explicit that
     * forcing 44px on a pointer device makes one control taller than its
     * neighbours for nobody's benefit.
     */
    @include mobileOnly {
        &--size-M {
            min-height: 44px;
        }
    }

    &--size-S {
        min-height: 32px;

        &.button--icon {
            width: 32px;
            height: 32px;
        }
    }

    &--type-link {
        justify-content: flex-start;

        height: auto;
        min-height: auto;
        padding: 0;
        border-radius: 0;

        font-size: var(--font-size-xs);
        color: var(--link-color);
        text-align: left;
        text-decoration: underline;

        background: transparent !important;

        &.button--icon {
            width: auto;
        }

        @include hover {
            &:hover {
                color: var(--hover-color);
            }

            &:focus, &:active {
                color: var(--focus-color);
            }
        }
    }

    &--disabled {
        opacity: 0.24;

        /*
         * The disabled primary keeps an INK label, not the variant's white one.
         * This background is a 2%-alpha white wash, effectively the page, so
         * white-on-white would be invisible, which is the regression the label
         * change above would otherwise have introduced in a state nobody looks
         * at. (The `opacity: 0.24` above is pre-existing and makes every
         * disabled control very faint regardless; that is a separate,
         * app-wide question and is deliberately not changed here.)
         */
        &.button--type-primary {
            color: $typographyPrimary;
            background: $whiteAlpha2;
        }

        &, &:deep(svg) {
            pointer-events: none;
            cursor: default;
        }
    }
}
</style>