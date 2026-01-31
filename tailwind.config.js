import { colors } from './src/theme/colors.js';

/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                brand: colors.brand,
                gray: colors.gray, // Override default gray with our tinted scale
                cost: colors.cost  // Semantic cost colors
            },
            animation: {
                shimmer: 'shimmer 1.5s ease-in-out infinite',
            },
            keyframes: {
                shimmer: {
                    '0%': { backgroundPosition: '-200% 0' },
                    '100%': { backgroundPosition: '200% 0' },
                },
            },
        },
    },
    plugins: [],
}

