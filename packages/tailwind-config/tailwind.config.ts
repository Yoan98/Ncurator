import type { Config } from 'tailwindcss/types/config';

export default {
    theme: {
        extend: {
            colors: {
                // background
                background: "var(--background)",
                "background-100": "var(--background-100)",
                "background-125": "var(--background-125)",
                "background-150": "var(--background-150)",
                "background-200": "var(--background-200)",
                "background-300": "var(--background-300)",
                "background-400": "var(--background-400)",
                "background-500": "var(--background-500)",
                "background-600": "var(--background-600)",
                "background-700": "var(--background-700)",
                "background-800": "var(--background-800)",
                "background-900": "var(--background-900)",

                "background-inverted": "var(--background-inverted)",
                "background-emphasis": "var(--background-emphasis)",
                "background-strong": "var(--background-strong)",
                "background-search": "var(--white)",

                "text-50": "var(--text-50)",
                "text-100": "var(--text-100)",
                "text-200": "var(--text-200)",
                "text-300": "var(--text-300)",
                "text-400": "var(--text-400)",
                "text-500": "var(--text-500)",
                "text-600": "var(--text-600)",
                "text-700": "var(--text-700)",
                "text-800": "var(--text-800)",
                "text-900": "var(--text-900)",
                "text-950": "var(--text-950)",

                "text-error": "var(--text-error)",
                "text-warning": "var(--text-warning)",
                "text-success": "var(--text-success)",



                // scrollbar
                scrollbar: {
                    track: "var(--scrollbar-track)",
                    thumb: "var(--scrollbar-thumb)",
                    "thumb-hover": "var(--scrollbar-thumb-hover)",

                    dark: {
                        thumb: "var(--scrollbar-dark-thumb)",
                        "thumb-hover": "var(--scrollbar-dark-thumb-hover)",
                    },
                },

            },
        },
    },
    plugins: [],
} as Omit<Config, 'content'>;
