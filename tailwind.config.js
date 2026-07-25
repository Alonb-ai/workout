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
          // Legible orange for text on a dark surface — the pure accent is too
          // hot at small sizes and vibrates against #06080b.
          text: '#ffa257',
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
        // "Variable" suffix is the family name @fontsource-variable registers.
        sans: [
          'Heebo Variable',
          'Heebo',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono Variable',
          '"JetBrains Mono"',
          'ui-monospace',
          'SFMono-Regular',
          'monospace',
        ],
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
        // A card is LIT from above: a hairline highlight on its top edge plus a
        // soft drop shadow. A field is CARVED IN: the highlight moves to the
        // bottom edge and the shadow goes inside. That inversion is what makes
        // "tap here to type" read without a single extra pixel of chrome.
        card: '0 1px 0 0 #ffffff0d inset, 0 10px 30px -16px #000000cc',
        raised: '0 1px 0 0 #ffffff12 inset, 0 16px 40px -20px #000000e6',
        field: '0 1px 2px 0 #00000080 inset, 0 -1px 0 0 #ffffff08 inset',
        soft: '0 1px 2px #0006, 0 1px 0 #ffffff0a inset',
        glow: '0 0 0 4px #ff7a1a33',
        'accent-lift': '0 6px 20px -8px #ff7a1a66',
      },
      keyframes: {
        pulseRing: {
          '0%': { boxShadow: '0 0 0 0 #ff7a1a66' },
          '100%': { boxShadow: '0 0 0 12px #ff7a1a00' },
        },
      },
      animation: {
        pulseRing: 'pulseRing 1.6s ease-out infinite',
      },
    },
  },
  plugins: [],
};
