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
                brand: colors.brand
            }
        },
    },
    plugins: [],
}

