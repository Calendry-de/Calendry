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
    // Two steps below 300 exist that no other ramp has, because no other ramp
    // is ever used as a GROUND: `primary200` tints a selected row, `primary100`
    // is a hover ground. Adding them to the semantic ramps would invite tinted
    // error/success grounds nobody has designed.
    primary700: '#1E6B61',
    primary600: '#257F72',
    primary500: BRAND,
    primary400: '#58B4A7',
    primary300: '#8ACDC3',
    primary200: '#D9EDE9',
    primary100: '#EFF7F5',

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
 * light ones. Nothing else is theme-dependent — the semantic colours read
 * acceptably on both grounds and are deliberately not duplicated here.
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
    },
} satisfies Record<string, PartialRecord<ColorsList, string>>;

/** 'default' is the light base; the UI labels it "Light". */
export type ThemesList = keyof typeof themesList | 'default';
