/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Dark, athletic palette. Energetic accent is a vibrant amber/orange — deliberately not the purple cliche.
        ink: {
          950: '#06080b',
          900: '#0b0d10',
          850: '#101317',
          800: '#161a1f',
          750: '#1c2026',
          700: '#22272e',
          600: '#2c323a',
          500: '#3a414b',
        },
        line: {
          DEFAULT: '#262b33',
          muted: '#1e232a',
        },
        fg: {
          DEFAULT: '#e8ecef',
          muted: '#9aa3ad',
          dim: '#6a727d',
          ghost: '#4a525c',
        },
        accent: {
          DEFAULT: '#ff7a1a',
          hover: '#ff8a35',
          soft: '#ff7a1a22',
          ring: '#ff7a1a55',
        },
        good: {
          DEFAULT: '#3ddc84',
          soft: '#3ddc8422',
        },
        bad: {
          DEFAULT: '#ff5c6c',
          soft: '#ff5c6c22',
        },
        warn: {
          DEFAULT: '#ffd166',
          soft: '#ffd16622',
        },
        info: {
          DEFAULT: '#6ec1ff',
          soft: '#6ec1ff22',
        },
      },
      fontFamily: {
        sans: [
          'Heebo',
          'Assistant',
          'Rubik',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif',
        ],
        mono: ['"JetBrains Mono"', '"Roboto Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', '0.95rem'],
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        card: '0 1px 0 0 #ffffff0a inset, 0 8px 24px -12px #00000080',
        soft: '0 1px 2px #0006, 0 1px 0 #ffffff0a inset',
        glow: '0 0 0 4px #ff7a1a33',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(12px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        pulseRing: {
          '0%': { boxShadow: '0 0 0 0 #ff7a1a66' },
          '100%': { boxShadow: '0 0 0 12px #ff7a1a00' },
        },
      },
      animation: {
        fadeIn: 'fadeIn 220ms ease-out',
        slideUp: 'slideUp 260ms cubic-bezier(0.2, 0.7, 0.2, 1)',
        pulseRing: 'pulseRing 1.6s ease-out infinite',
      },
    },
  },
  plugins: [],
};
