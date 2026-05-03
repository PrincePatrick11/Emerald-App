/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // App background — slightly lighter than pure black
        stone: {
          950: '#0f0e0c',
        },
        // Magical green accent — jewel-like, slightly blue-tinted
        jade: {
          50:  '#edfff7',
          100: '#d5ffee',
          200: '#aeffdd',
          300: '#70ffca',
          400: '#2dfdb0',
          500: '#00e699',  // primary bright
          600: '#00c47f',  // buttons, links
          700: '#00a066',  // hover states
          800: '#007a4d',  // borders
          900: '#005c3a',  // deep backgrounds
          950: '#002e1d',  // darkest
        },
        parchment: {
          50:  '#fdf8f0',
          100: '#faf0dc',
          200: '#f4ddb5',
          300: '#ecc685',
          400: '#e2a854',
          500: '#d98c34',
          600: '#c97229',
          700: '#a75924',
          800: '#874824',
          900: '#6d3c21',
          950: '#3b1d0f',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        serif: ['Lora', 'Georgia', 'serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-in-out',
        'slide-in': 'slideIn 0.2s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%': { transform: 'translateX(10px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
