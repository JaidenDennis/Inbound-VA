import type { Config } from 'tailwindcss';

/**
 * GRAVVIA ENGAGE — token bindings.
 *
 * This file contains NO colour values. Every colour resolves to a CSS
 * custom property defined in src/app/globals.css, which is the single
 * home for raw hex. That indirection is what makes dark mode one
 * attribute on <html> instead of a `dark:` variant in 69 files.
 *
 * Two rules carried forward from the 2026-08-07 revamp:
 *  1. NAMES ARE PRESERVED, VALUES ARE REPLACED. Legacy ramps keep
 *     their names so the ~20 routes never hand-revised inherit the new
 *     world instead of rendering unstyled.
 *  2. Elevation is declared once: hairline border OR hard offset,
 *     never both, and never a blurred shadow.
 *
 * The rule that CHANGED: chroma is no longer reserved for state.
 * Cobalt means "you can act on this"; green/amber/red mean state.
 * Neither hue ever crosses into the other's job.
 */

/** Solid token → `rgb(var(--x) / <alpha-value>)`, so `bg-action/50` works. */
const c = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

const neutral = {
  25: c('--n-25-rgb'),   50: c('--n-50-rgb'),   100: c('--n-100-rgb'),
  200: c('--n-200-rgb'), 300: c('--n-300-rgb'), 400: c('--n-400-rgb'),
  500: c('--n-500-rgb'), 600: c('--n-600-rgb'), 700: c('--n-700-rgb'),
  800: c('--n-800-rgb'), 900: c('--n-900-rgb'), 950: c('--n-950-rgb'),
};

// The interactive/text ramp. Same inverted neutral ends — `ink-900` is
// the strongest text colour in either theme.
const ink = {
  50: c('--n-50-rgb'),   100: c('--n-100-rgb'), 200: c('--n-200-rgb'),
  300: c('--n-300-rgb'), 400: c('--n-400-rgb'), 500: c('--n-500-rgb'),
  600: c('--n-600-rgb'), 700: c('--n-700-rgb'), 800: c('--n-800-rgb'),
  900: c('--n-950-rgb'),
};

// Cobalt, exposed as a ramp so the 199 existing `signal-*` references
// land on the brand colour in place.
const action = {
  50: 'var(--action-wash)',   100: 'var(--action-wash-2)',
  200: 'var(--action-rim)',   300: 'var(--action-rim)',
  400: c('--action-rgb'),     500: c('--action-rgb'),
  600: c('--action-rgb'),     700: c('--action-rgb'),
  800: c('--action-hover-rgb'), 900: c('--action-hover-rgb'),
  DEFAULT: c('--action-rgb'),
};

const lamp = {
  good: c('--lamp-good-rgb'),
  'good-ink': c('--lamp-good-ink-rgb'),
  'good-wash': 'var(--lamp-good-wash)',
  'good-rim': 'var(--lamp-good-rim)',
  fair: c('--lamp-fair-rgb'),
  'fair-ink': c('--lamp-fair-ink-rgb'),
  'fair-wash': 'var(--lamp-fair-wash)',
  'fair-rim': 'var(--lamp-fair-rim)',
  bad: c('--lamp-bad-rgb'),
  'bad-ink': c('--lamp-bad-ink-rgb'),
  'bad-wash': 'var(--lamp-bad-wash)',
  'bad-rim': 'var(--lamp-bad-rim)',
  'bad-on-dark': c('--lamp-bad-on-dark-rgb'),
  off: c('--lamp-off-rgb'),
  'off-ink': c('--lamp-off-ink-rgb'),
};

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ---- Semantic surface tokens (new; prefer these) ----
        surface: {
          DEFAULT: c('--surface-rgb'),
          raised: c('--surface-raised-rgb'),
          inset: c('--surface-inset-rgb'),
          dark: c('--surface-dark-rgb'),
          'dark-inset': c('--surface-dark-inset-rgb'),
        },
        text: {
          DEFAULT: c('--text-rgb'),
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
          faint: 'var(--text-faint)',
          'on-dark': 'var(--text-on-dark)',
          'on-dark-secondary': 'var(--text-on-dark-secondary)',
          'on-dark-muted': 'var(--text-on-dark-muted)',
        },
        action: action,
        hairline: 'var(--hairline)',
        rule: 'var(--rule)',
        edge: c('--edge-rgb'),
        'tint-on-dark': c('--tint-on-dark-rgb'),
        'action-on-dark': c('--action-on-dark-rgb'),
        scrim: 'var(--scrim)',
        lamp,

        // ---- Legacy names preserved, values replaced ----
        panel: neutral,
        ink,
        signal: action,      // was teal; cobalt takes the role
        primary: action,     // was graphite; the brand colour now leads
        navy: neutral,
        gray: neutral,
        secondary: action,
        blue: action,        // finally true — blue IS the brand
        accent: {
          50: 'var(--lamp-fair-wash)', 100: 'var(--lamp-fair-wash)',
          200: 'var(--lamp-fair-rim)',
          500: c('--lamp-fair-rgb'), 600: c('--lamp-fair-ink-rgb'),
        },
        brand: {
          50: 'var(--action-wash)', 500: c('--action-rgb'),
          600: c('--action-rgb'), 700: c('--action-hover-rgb'),
        },
        emerald: {
          50: 'var(--lamp-good-wash)', 100: 'var(--lamp-good-wash)',
          200: 'var(--lamp-good-rim)', 300: 'var(--lamp-good-rim)',
          500: c('--lamp-good-rgb'), 600: c('--lamp-good-ink-rgb'),
          700: c('--lamp-good-ink-rgb'), 800: c('--lamp-good-ink-rgb'),
          900: c('--lamp-good-ink-rgb'),
        },
        green: {
          50: 'var(--lamp-good-wash)', 100: 'var(--lamp-good-wash)',
          200: 'var(--lamp-good-rim)', 300: 'var(--lamp-good-rim)',
          500: c('--lamp-good-rgb'), 600: c('--lamp-good-ink-rgb'),
          700: c('--lamp-good-ink-rgb'), 800: c('--lamp-good-ink-rgb'),
          900: c('--lamp-good-ink-rgb'),
        },
        amber: {
          50: 'var(--lamp-fair-wash)', 100: 'var(--lamp-fair-wash)',
          200: 'var(--lamp-fair-rim)', 300: 'var(--lamp-fair-rim)',
          500: c('--lamp-fair-rgb'), 600: c('--lamp-fair-ink-rgb'),
          700: c('--lamp-fair-ink-rgb'), 800: c('--lamp-fair-ink-rgb'),
          900: c('--lamp-fair-ink-rgb'),
        },
        yellow: {
          50: 'var(--lamp-fair-wash)', 100: 'var(--lamp-fair-wash)',
          200: 'var(--lamp-fair-rim)',
          500: c('--lamp-fair-rgb'), 600: c('--lamp-fair-ink-rgb'),
          700: c('--lamp-fair-ink-rgb'), 800: c('--lamp-fair-ink-rgb'),
          900: c('--lamp-fair-ink-rgb'),
        },
        red: {
          50: 'var(--lamp-bad-wash)', 100: 'var(--lamp-bad-wash)',
          200: 'var(--lamp-bad-rim)', 300: 'var(--lamp-bad-rim)',
          500: c('--lamp-bad-rgb'), 600: c('--lamp-bad-ink-rgb'),
          700: c('--lamp-bad-ink-rgb'), 800: c('--lamp-bad-ink-rgb'),
          900: c('--lamp-bad-ink-rgb'),
        },
      },

      ringOffsetColor: { DEFAULT: c('--surface-rgb') },

      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        heading: ['var(--font-sans)', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },

      // Kept — this scale is tuned for console density. Tracking retuned
      // for DM Sans, whose default fit is looser than Archivo's.
      fontSize: {
        '2xs': ['11px', { lineHeight: '14px', letterSpacing: '0.02em' }],
        xs: ['12px', { lineHeight: '16px' }],
        sm: ['13px', { lineHeight: '19px' }],
        base: ['15px', { lineHeight: '23px' }],
        lg: ['17px', { lineHeight: '26px' }],
        xl: ['20px', { lineHeight: '28px', letterSpacing: '-0.012em' }],
        '2xl': ['25px', { lineHeight: '31px', letterSpacing: '-0.02em' }],
        '3xl': ['31px', { lineHeight: '36px', letterSpacing: '-0.022em' }],
        '4xl': ['39px', { lineHeight: '42px', letterSpacing: '-0.026em' }],
        '5xl': ['49px', { lineHeight: '52px', letterSpacing: '-0.03em' }],
      },

      // HARD OFFSETS ONLY. No blur, no zero-offset halos. `xs`..`xl` keep
      // their names so untouched routes inherit the new world; they all
      // resolve to the ink offset, because a floating layer is the only
      // thing in this system that may cast one.
      boxShadow: {
        none: 'none',
        xs: '2px 2px 0 0 rgb(var(--edge-rgb) / 0.10)',
        sm: '3px 3px 0 0 rgb(var(--edge-rgb) / 0.12)',
        md: '4px 4px 0 0 rgb(var(--edge-rgb) / 0.16)',
        lg: '6px 6px 0 0 rgb(var(--edge-rgb) / 0.20)',
        xl: '8px 8px 0 0 rgb(var(--edge-rgb) / 0.24)',
        cobalt: '6px 6px 0 0 rgb(var(--action-rgb))',
        'cobalt-sm': '3px 3px 0 0 rgb(var(--action-rgb))',
        seat: 'none',   // the old inset-highlight look has no place in a flat world
      },

      // Radius 0 on every named step. All 335 existing `rounded-*` classes
      // go square with zero file edits; `rounded-full` keeps the dots round.
      borderRadius: {
        none: '0', sm: '0', DEFAULT: '0', md: '0',
        lg: '0', xl: '0', '2xl': '0', '3xl': '0',
        full: '9999px',
      },

      transitionTimingFunction: { out: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      transitionDuration: { 120: '120ms', 150: '150ms', 200: '200ms', 300: '300ms' },

      keyframes: {
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
