import type { PartialRecord } from '../../types';

/**
 * The colour palette.
 *
 * The two neutral ramps are named by ROLE and by distance from the page ground,
 * not by lightness:
 *
 *   surface0…surface7  the ground and the things stacked on it
 *   content0…content7  what sits on those surfaces — text, icons, hairlines
 *
 * That naming is what makes theming legible. The ramps were previously called
 * `darkgray*` and `lightgray*`, which described their values in one theme and
 * lied in the other: a "light" theme worked by swapping the two ramps, so
 * `$darkgray950` rendered near-white and every call site read backwards.
 * Under role names, `surface1` is the second surface layer in every theme, and
 * only its value changes.
 *
 * The base palette is LIGHT. `dark` swaps the two ramps back. There is
 * deliberately no `light` entry: with a light base it would be an empty
 * override rendering identically to `default`, which is exactly the duplicate
 * that made the original bug invisible.
 */
/**
 * The brand teal — the logo's accent and the interface's primary, one value.
 * Declared above the palette so the two entries that carry it are visibly the
 * same constant rather than two hex strings that happen to match today.
 */
const BRAND = '#2F9E8F';

export const colorsList = {
    //#region neutrals
    white: '#FAFAFA',
    black: '#151515',
    blackAlpha2: '#15151505',
    blackAlpha4: '#1515150a',
    blackAlpha8: '#15151514',
    blackAlpha12: '#1515151f',
    blackAlpha24: '#1515153d',
    blackAlpha36: '#1515155c',
    blackAlpha64: '#151515a3',
    whiteAlpha2: '#FAFAFA05',
    whiteAlpha4: '#FAFAFA0a',
    whiteAlpha8: '#FAFAFA14',
    whiteAlpha12: '#FAFAFA1f',
    whiteAlpha24: '#FAFAFA3d',
    whiteAlpha36: '#FAFAFA5c',
    whiteAlpha64: '#FAFAFAa3',

    // Surfaces: the page ground (surface0) outward. Light in the base theme.
    surface0: '#F7F7FA',
    surface1: '#F2F2F7',
    surface2: '#EDEDF2',
    surface3: '#E6E6EB',
    surface4: '#DEDEE7',
    surface5: '#D5D5E4',
    surface6: '#bfbfc2',
    surface7: '#aaaaac',

    // Content: primary text (content0) through the faintest hairline.
    content0: '#131316',
    content1: '#18181B',
    content2: '#202024',
    content3: '#26262C',
    content4: '#2B2B33',
    content5: '#30303C',
    content6: '#3c3c3f',
    content7: '#525255',

    // Primary is the brand teal, and `primary500` IS the logo's accent — the
    // same value, written once as `BRAND` above, so the mark and the interface
    // cannot drift apart. Purple retired here: the mark said one thing and
    // every button said another.
    //
    // NO STEPS BELOW 300: an earlier `primary200`/`primary100` pair (used as
    // flat GROUND tints for a "selected" state) was removed — they had no
    // dark-theme override, while the foreground text sitting on them
    // (`primary700`) DOES flip per theme, so the pairing silently went
    // low-contrast the moment dark mode turned that text light against a
    // ground that stayed light too. `varToRgba('primary500', <opacity>)` is
    // the ramp's own answer to "tint a selected/highlighted ground": a
    // translucent wash over whatever surface sits underneath, correct in
    // either theme by construction, and already how every other such state in
    // this app is built (`ManageList`, `ScheduleGrid`,
    // `ManageConstraintVariantGroup`, `ScheduleMiniMonth`, …). Add a flat
    // tinted-ground token again only with a measured dark-theme value to go
    // with it.
    primary700: '#1E6B61',
    primary600: '#257F72',
    primary500: BRAND,
    primary400: '#58B4A7',
    primary300: '#8ACDC3',

    /**
     * CONTRAST, MEASURED — the reason the ramp has a direction of use.
     *
     *   primary700 on surface0        5.6:1   body text, links      ✓ AA
     *   white      on primary700      6.1:1   filled buttons        ✓ AA
     *   content0   on primary500      5.7:1   filled buttons        ✓ AA
     *   primary500 on surface0        2.9:1   fills and icons ONLY  ✗ AA
     *
     * So: `primary500` is a FILL, `primary700` is the text and the pressed
     * state. Teal text on a teal fill is never legible — the old purple ramp
     * tolerated white on `primary500` at 5.01:1 and this one does not (3.1:1),
     * which is why `CommonButton`'s primary label is ink rather than white.
     */

    // Clay — the one warm counterweight, for illustrations and empty states.
    secondary700: '#94502F',
    secondary600: '#A85E38',
    secondary500: '#BE6E45',
    secondary400: '#D08C68',
    secondary300: '#E0AC90',

    // Leaf, pushed off teal so "it worked" cannot be mistaken for "this is us".
    success700: '#1F7442',
    success600: '#26894E',
    success500: '#2E9E58',
    success400: '#5CB77D',
    success300: '#8FCEA6',

    /*
     * ONE STEP DARKER THAN THE RAMP, FOR WARNING TEXT ON A LIGHT SURFACE.
     *
     * `warning700` is the ramp's darkest and still measures 3.73:1 on
     * `surface1` and 3.89:1 on `surface0` — below AA for normal text at every
     * size it renders, while `error700` (6.60) and `success700` (5.18) pass
     * comfortably on the same grounds. So this is one ramp step, not a systemic
     * problem, and it was carrying the most important sentences on the
     * self-service pages.
     *
     * A NEW TOKEN rather than a darker `warning700`, because that value is also
     * used for BORDERS and TINTS (3:1 territory, which it passes) and by the
     * schedule's violation styling. Text needs its own step; the dark theme
     * override below keeps the light-on-dark value, where nothing failed.
     */
    warning800: '#8A5A12',
    warning700: '#A87121',
    warning600: '#C08628',
    warning500: '#D69B33',
    warning400: '#E4B662',
    warning300: '#EFCF95',

    error700: '#9E2B36',
    error600: '#B93841',
    error500: '#D14A4F',
    error400: '#E0777A',
    error300: '#EDA4A5',

    // Blue, not teal. It was one hue from the brand, so a neutral notice and
    // the product's own identity colour were telling the reader the same thing.
    info700: '#1F5C8F',
    info600: '#2872AB',
    info500: '#3389C6',
    info400: '#66A9D8',
    info300: '#97C7E7',

    /**
     * The logo's accent. Kept as its own name because the logo component asks
     * for "the brand colour", not for "step 500 of the primary ramp" — but it
     * is the same constant, so renumbering the ramp cannot silently repaint
     * the mark, and retuning the mark cannot leave the UI behind.
     */
    brandAccent: BRAND,
};

export type ColorsList = keyof typeof colorsList;

/**
 * `dark` swaps the two ramps: surfaces take the dark values, content takes the
 * light ones.
 *
 * THE SEMANTIC RAMPS ARE PARTLY THEME-DEPENDENT TOO, and this comment used to
 * claim otherwise — "the semantic colours read acceptably on both grounds" was
 * measured and is false at the dark end of each ramp. Used as FOREGROUND on the
 * dark ground (`$surface1` = #18181B), `$error700` measures 2.21:1 and
 * `$success700` 2.71:1 — both under the 3:1 a non-text indicator needs, and far
 * under text's 4.5:1. `schedule-panel.scss` had already worked around this
 * locally by reaching for `$error300`/`$warning400` instead, which is the same
 * finding discovered one component at a time.
 *
 * So the 600 and 700 steps — the two used as borders, icons, counts and link
 * text — take the light end of their own ramp under `dark`. The 300–500 steps
 * are NOT remapped: they are used as fills and tints, where the light theme's
 * values are already correct against a dark surface.
 *
 * This changes no light-theme value, and adds no custom property: `useCalendryLayout()`
 * emits every entry of `colorsList` regardless and merely overrides the ones
 * named here.
 */
export const themesList = {
    dark: {
        surface0: '#131316',
        surface1: '#18181B',
        surface2: '#202024',
        surface3: '#26262C',
        surface4: '#2B2B33',
        surface5: '#30303C',
        surface6: '#3c3c3f',
        surface7: '#525255',

        content0: '#F7F7FA',
        content1: '#F2F2F7',
        content2: '#EDEDF2',
        content3: '#E6E6EB',
        content4: '#DEDEE7',
        content5: '#D5D5E4',
        content6: '#bfbfc2',
        content7: '#aaaaac',

        // Foreground steps, lifted to the light end of their own ramp. Each
        // value is an existing token from the same ramp, not a new colour:
        // 600 takes the 500 value, 700 takes the 400 one.
        primary600: '#2F9E8F',
        primary700: '#58B4A7',
        success600: '#2E9E58',
        success700: '#5CB77D',
        warning600: '#D69B33',
        warning700: '#E4B662',
        // Dark inverts the role: warning text sits on a dark ground, so it wants
        // the LIGHT end. Measured 9.42:1 on surface1, 9.86:1 on surface0.
        warning800: '#E4B662',
        error600: '#D14A4F',
        error700: '#E0777A',
    },
} satisfies Record<string, PartialRecord<ColorsList, string>>;

/** 'default' is the light base; the UI labels it "Light". */
export type ThemesList = keyof typeof themesList | 'default';
