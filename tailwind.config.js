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
      // Colours come from the theme files, nowhere else (Documentation/design.md).
      textColor: {
        'primary': 'var(--text-primary)',
        'secondary': 'var(--text-secondary)',
        'soft': 'var(--text-soft)',
        'muted': 'var(--text-muted)',
        'subtle': 'var(--text-subtle)',
        'faint': 'var(--text-faint)',
        'raise': 'var(--text-raise)',
        'on-accent': 'var(--text-on-accent)',
        'accent': 'var(--accent-text)',
        'accent-raise': 'var(--accent-text-raise)',
        'danger': 'var(--danger-text)',
        'danger-raise': 'var(--danger-hover-text)',
        'warning': 'var(--warning-text)',
        'success': 'var(--success-text)',
      },
      backgroundColor: {
        'well': 'var(--well)',
        'well-strong': 'var(--well-strong)',
        'well-raise': 'var(--well-raise)',
        'well-solid': 'var(--well-solid)',
        'well-active': 'var(--well-active)',
        'well-sunk': 'var(--well-sunk)',
        'well-deep': 'var(--well-deep)',
        'well-tint': 'var(--well-tint)',
        'well-page': 'var(--well-page)',
        'overlay': 'var(--overlay)',
        'canvas': 'var(--canvas)',
        'accent-wash': 'var(--accent-wash)',
        'accent-wash-strong': 'var(--accent-wash-strong)',
        'accent-track': 'var(--accent-track)',
        'accent-fill': 'var(--accent-fill)',
        'accent-fill-strong': 'var(--accent-fill-strong)',
        'danger-wash': 'var(--danger-wash)',
        'accent': 'var(--accent)',
      },
      borderColor: {
        'edge': 'var(--edge)',
        'edge-strong': 'var(--edge-strong)',
        'edge-raise': 'var(--edge-raise)',
        'edge-default': 'var(--border-default)',
        'accent-edge': 'var(--accent-edge)',
        'contrast': 'var(--text-primary)',
      },
      gradientColorStops: {
        'edge-strong': 'var(--edge-strong)',
        'well': 'var(--well)',
        'well-tint': 'var(--well-tint)',
        'well-page': 'var(--well-page)',
        'well-strong': 'var(--well-strong)',
        'well-sunk': 'var(--well-sunk)',
      },
      ringColor: {
        'focus': 'var(--focus-ring)',
      },
      ringOffsetColor: {
        'well-page': 'var(--well-page)',
      },
      accentColor: {
        'accent': 'var(--accent)',
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
