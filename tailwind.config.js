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
      },
      boxShadow: {
        menu: 'var(--menu-shadow)',
      },
      // Colours come from the theme files, nowhere else (Documentation/design.md).
      textColor: {
        'primary': 'var(--text-primary)',
        'secondary': 'var(--text-secondary)',
        'soft': 'var(--text-soft)',
        'muted': 'var(--text-muted)',
        'subtle': 'var(--text-subtle)',
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
