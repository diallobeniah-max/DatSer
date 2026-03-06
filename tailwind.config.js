/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c',
          800: '#9a3412',
          900: '#7c2d12',
        },
        // Google-style dark mode colors (true black/dark, no blue tint)
        gray: {
          50: '#fafafa',
          100: '#f5f5f5',
          200: '#e5e5e5',
          300: '#d4d4d4',
          400: '#a3a3a3',
          500: '#737373',
          600: '#525252',
          700: '#303030',  // Cards/surfaces in dark mode
          800: '#212121',  // Elevated surfaces in dark mode
          900: '#121212',  // Main background in dark mode (Google dark)
          950: '#0a0a0a',  // Deepest black
        }
      }
    },
  },
  plugins: [],
  darkMode: 'class',
}
