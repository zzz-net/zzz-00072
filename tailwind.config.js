/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      colors: {
        primary: {
          50: '#eef3f9',
          100: '#d6e3ef',
          200: '#adc3df',
          300: '#7fa0ca',
          400: '#517eb5',
          500: '#305f9a',
          600: '#254b7d',
          700: '#1e3a5f',
          800: '#192f4d',
          900: '#142540',
        },
        accent: {
          50: '#fff8eb',
          100: '#ffeccb',
          200: '#ffd78c',
          300: '#ffbd4d',
          400: '#ffa71f',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
        },
      },
      fontFamily: {
        sans: ['"Source Han Sans SC"', '"Noto Sans SC"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
