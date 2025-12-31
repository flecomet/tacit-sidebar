/**
 * Central color palette for Tacit
 * Implements the "Easy Way" OKLCH methodology:
 * - Constant Hue (264 - Cool Blue) for consistency
 * - Low Chroma (~0.025) for neutrals (no dead greys)
 * - Uses / <alpha-value> syntax to support Tailwind opacity modifiers
 */

export const colors = {
    // Brand specific tokens
    brand: {
        dark: 'oklch(0.12 0.025 264 / <alpha-value>)',    // Main BG
        card: 'oklch(0.17 0.025 264 / <alpha-value>)',    // Surface

        // Vibrant Cyan/Blue
        cyan: 'oklch(0.75 0.14 216 / <alpha-value>)',

        // Semantic overrides
        text: 'oklch(0.96 0.01 264 / <alpha-value>)',
        textSecondary: 'oklch(0.76 0.025 264 / <alpha-value>)',
        border: 'oklch(0.25 0.025 264 / <alpha-value>)',
        input: 'oklch(0.20 0.025 264 / <alpha-value>)',
        hover: 'oklch(0.22 0.025 264 / <alpha-value>)',
    },

    // Tinted Gray Scale (Overrides Tailwind 'gray')
    // Hue 264 (Cool Blue) baked in
    gray: {
        50: 'oklch(0.98 0.01 264 / <alpha-value>)',
        100: 'oklch(0.96 0.015 264 / <alpha-value>)',
        200: 'oklch(0.88 0.02 264 / <alpha-value>)',
        300: 'oklch(0.80 0.025 264 / <alpha-value>)',
        400: 'oklch(0.70 0.03 264 / <alpha-value>)',
        500: 'oklch(0.60 0.035 264 / <alpha-value>)',
        600: 'oklch(0.50 0.035 264 / <alpha-value>)',
        700: 'oklch(0.40 0.035 264 / <alpha-value>)',
        800: 'oklch(0.30 0.03 264 / <alpha-value>)',
        900: 'oklch(0.20 0.025 264 / <alpha-value>)',
        950: 'oklch(0.14 0.025 264 / <alpha-value>)',
    }
};

export default colors;
