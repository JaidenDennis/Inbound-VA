import type { Config } from 'tailwindcss';

/**
 * GRAVVIA ENGAGE — supervisory panel token layer.
 *
 * The world is a precision instrument read in daylight, not a dark AI console.
 * Two rules govern every value below:
 *
 *  1. CHROMA IS RESERVED FOR STATE. Green, amber, and red mean good, fair, and
 *     bad — nothing else on the surface is allowed to use them. Interactive
 *     affordance is therefore achromatic (ink), so a primary button can never
 *     be mistaken for a healthy row.
 *  2. NAMES ARE PRESERVED, VALUES ARE REPLACED. Legacy ramps (primary, navy,
 *     secondary, accent, brand, gray) keep their names so routes that were not
 *     hand-revised inherit the new world instead of rendering unstyled.
 *
 * Elevation is declared once: hairline border OR shadow, never both. Shadows
 * belong only to genuinely floating layers (drawer, toast, menu).
 */

// Panel grey — cool, faintly green-shifted so it reads as instrument housing
// rather than the default blue-slate every dashboard ships.
const panel = {
  25: '#FAFBFB',
  50: '#F4F6F6',
  100: '#E9ECEC',
  200: '#D8DDDD',
  300: '#BCC4C4',
  400: '#939D9D',
  500: '#6E7878',
  600: '#545D5D',
  700: '#414949',
  800: '#2B3131',
  900: '#1A1E1E',
  950: '#0E1111',
};

// Ink — the achromatic interactive ramp. Primary actions, active nav, controls.
const ink = {
  50: '#F5F6F6',
  100: '#E4E6E6',
  200: '#C6CACA',
  300: '#9BA1A1',
  400: '#6B7373',
  500: '#4A5152',
  600: '#363C3D',
  700: '#262B2C',
  800: '#1A1E1F',
  900: '#101314',
};

// Signal — a cool teal that is emphatically not a lamp hue. Focus rings, links,
// selection, and the one accent allowed to sit next to status without competing.
const signal = {
  50: '#EFF7F9',
  100: '#D6EBF0',
  200: '#A9D6E0',
  300: '#6FB6C7',
  400: '#3D93A8',
  500: '#1E7A90',
  600: '#0B6E7F',
  700: '#095868',
  800: '#0A4553',
  900: '#0A3844',
};

// Lamps — jewel status hues. `core` is the lit lens, `ink` is the text weight
// that clears 4.5:1 on panel-25/50, `wash` is the seated background.
const lamp = {
  good: '#1FA35F',
  'good-ink': '#0E7042',
  'good-wash': '#E6F5EC',
  'good-rim': '#B4DFC6',
  fair: '#E0921A',
  'fair-ink': '#8A5600',
  'fair-wash': '#FCF2E0',
  'fair-rim': '#EFD5A6',
  bad: '#DC3B30',
  'bad-ink': '#A81E17',
  'bad-wash': '#FCEBEA',
  'bad-rim': '#F0BDB8',
};

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        panel,
        ink,
        signal,
        lamp,

        // ---- Legacy names, remapped so untouched routes inherit the world ----

        // Was enterprise blue. Now the achromatic interactive ramp, so every
        // existing `bg-primary-600` CTA becomes graphite rather than blue.
        primary: ink,
        // Was deep corporate navy (surfaces + dark panels). Now panel housing.
        navy: panel,
        // Was sky blue. Now the teal signal accent.
        secondary: signal,
        // Was amber CTA. Collapsed onto the fair lamp so it can never read as a
        // call-to-action competing with real status.
        accent: {
          50: lamp['fair-wash'],
          100: lamp['fair-wash'],
          200: lamp['fair-rim'],
          500: lamp.fair,
          600: lamp['fair-ink'],
        },
        brand: {
          50: ink[50],
          500: ink[600],
          600: ink[700],
          700: ink[800],
        },

        // Tailwind's default neutral is blue-slate; override it so the whole app
        // sits in one grey family instead of two competing ones.
        gray: panel,

        // Status families remapped to the jewel lamps so every pre-existing
        // `text-red-700` / `bg-emerald-50` lands on the same three states.
        emerald: {
          50: lamp['good-wash'], 100: lamp['good-wash'], 200: lamp['good-rim'],
          300: lamp['good-rim'], 500: lamp.good, 600: lamp['good-ink'],
          700: lamp['good-ink'], 800: '#0A5532', 900: '#0A5532',
        },
        green: {
          50: lamp['good-wash'], 100: lamp['good-wash'], 200: lamp['good-rim'],
          300: lamp['good-rim'], 500: lamp.good, 600: lamp['good-ink'],
          700: lamp['good-ink'], 800: '#0A5532', 900: '#0A5532',
        },
        amber: {
          50: lamp['fair-wash'], 100: lamp['fair-wash'], 200: lamp['fair-rim'],
          300: lamp['fair-rim'], 500: lamp.fair, 600: lamp['fair-ink'],
          700: lamp['fair-ink'], 800: '#6E4400', 900: '#6E4400',
        },
        yellow: {
          50: lamp['fair-wash'], 100: lamp['fair-wash'], 200: lamp['fair-rim'],
          500: lamp.fair, 600: lamp['fair-ink'], 700: lamp['fair-ink'],
          800: '#6E4400', 900: '#6E4400',
        },
        red: {
          50: lamp['bad-wash'], 100: lamp['bad-wash'], 200: lamp['bad-rim'],
          300: lamp['bad-rim'], 500: lamp.bad, 600: lamp['bad-ink'],
          700: lamp['bad-ink'], 800: '#821510', 900: '#821510',
        },
        blue: signal,
      },

      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        heading: ['var(--font-sans)', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        // Mono is for measurement — counts, durations, ids, routes, stacks.
        // It is never used as a costume for "technical".
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },

      fontSize: {
        // Instrument labels run small and tight; data runs at comfortable size.
        '2xs': ['11px', { lineHeight: '14px', letterSpacing: '0.02em' }],
        xs: ['12px', { lineHeight: '16px' }],
        sm: ['13px', { lineHeight: '19px' }],
        base: ['15px', { lineHeight: '23px' }],
        lg: ['17px', { lineHeight: '26px' }],
        xl: ['20px', { lineHeight: '28px' }],
        '2xl': ['25px', { lineHeight: '32px', letterSpacing: '-0.018em' }],
        '3xl': ['31px', { lineHeight: '38px', letterSpacing: '-0.022em' }],
        '4xl': ['39px', { lineHeight: '44px', letterSpacing: '-0.028em' }],
        '5xl': ['49px', { lineHeight: '54px', letterSpacing: '-0.032em' }],
      },

      // Shadows are for floating layers only. Every one carries a real offset
      // and a soft blur — no zero-offset halos.
      boxShadow: {
        xs: '0 1px 1px 0 rgba(14, 17, 17, 0.04)',
        sm: '0 1px 2px 0 rgba(14, 17, 17, 0.06)',
        md: '0 4px 10px -2px rgba(14, 17, 17, 0.10), 0 2px 4px -2px rgba(14, 17, 17, 0.06)',
        lg: '0 12px 28px -6px rgba(14, 17, 17, 0.16), 0 4px 10px -4px rgba(14, 17, 17, 0.08)',
        xl: '0 24px 56px -12px rgba(14, 17, 17, 0.22), 0 8px 20px -8px rgba(14, 17, 17, 0.10)',
        // Seated control: the panel-inset look, used on the nav rail's active row.
        seat: 'inset 0 1px 0 0 rgba(255, 255, 255, 0.55), inset 0 -1px 0 0 rgba(14, 17, 17, 0.05)',
      },

      // One documented radius rule: cards 12, controls 6, chips full-pill.
      borderRadius: {
        none: '0',
        sm: '4px',
        DEFAULT: '6px',
        md: '6px',
        lg: '8px',
        xl: '12px',
        '2xl': '14px',
      },

      transitionTimingFunction: {
        // Exponential ease-out, per the craft floor.
        out: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      transitionDuration: { 150: '150ms', 200: '200ms', 300: '300ms' },

      keyframes: {
        // The lamp's live breath. Applied only to the single lamp that is
        // actively reporting a bad state, never to every lamp on the page.
        pulse_lamp: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.55', transform: 'scale(0.88)' },
        },
        sweep: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'lamp-live': 'pulse_lamp 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        sweep: 'sweep 1.6s cubic-bezier(0.16, 1, 0.3, 1) infinite',
      },
    },
  },
  plugins: [],
};

export default config;
