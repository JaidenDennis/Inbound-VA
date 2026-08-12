import type { Metadata } from 'next';
import { DM_Sans, DM_Mono } from 'next/font/google';
import { Toaster } from 'react-hot-toast';
import './globals.css';

// DM Sans — the marketing site's face. Body runs at 400; the site's 300
// is unreadable at 13px, so 300 is reserved for display sizes >= 25px.
const sans = DM_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '700'],
  variable: '--font-sans',
  display: 'swap',
});

// DM Mono carries every micro-label and every figure.
// NOTE: DM Mono ships 300/400/500 ONLY — there is no 600 or 700. The
// previous JetBrains_Mono declaration requested 600; requesting it here
// fails the build. (Verified: no `font-mono` + `font-semibold` class
// pairs exist in src, so nothing downstream needs the missing weight.)
const mono = DM_Mono({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Gravvia Engage — AI Voice Operations',
  description:
    'Operations console for AI voice: inbound calls, lead capture, booking, and CRM synchronisation across every client.',
};

const DIRECTION_CONTRACT = `<!-- impeccable:direction seed=none-roll-unavailable
THESIS: The console is the same building as gravvia.com. Bone, ink, and
cobalt; corners are zero; the only shadows are hard cobalt offsets.
OWN-WORLD: DM Sans and DM Mono. Mono carries every micro-label and every
figure. Cobalt means "you can act on this"; green/amber/red mean state;
neither hue crosses into the other's job.
STORY: The operator learns what is wrong before reading a word, then
reaches the failing record in one move.
FIRST VIEWPORT: Dark console rail against bone; a hard-ruled lamp strip
reporting live system state from real severity counts; the worst-first
register beneath it.
FORM: Brand transplant from the shipped marketing site, not a roll.
FINISH: unreviewed and undocumented is unfinished; this build ends with
the finish review, the verdict, and DESIGN.md
-->`;

/**
 * Runs before first paint. Without this the browser paints the light
 * default, then React swaps to dark — a visible flash on every load.
 * Stringified because it must be inline; it cannot wait for hydration.
 */
const THEME_BOOT = `(function(){try{var t=localStorage.getItem('gravvia_theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="font-sans antialiased">
        {/* The direction contract must survive into emitted markup so it can be
            audited after the build. A JSX comment is a JavaScript comment and
            never reaches the HTML, so it is injected as a real one. */}
        <div hidden aria-hidden dangerouslySetInnerHTML={{ __html: DIRECTION_CONTRACT }} />
        {children}
        {/* z-50 keeps toasts above the drawer (20) and any modal (30). */}
        <Toaster
          position="bottom-right"
          containerClassName="z-50"
          toastOptions={{
            duration: 4000,
            className: 'text-sm',
            // Tokens, not hex — these must follow the theme.
            style: {
              background: 'rgb(var(--surface-raised-rgb))',
              color: 'rgb(var(--text-rgb))',
              border: '1px solid var(--hairline)',
              borderRadius: 0,
            },
            success: { iconTheme: { primary: 'rgb(var(--lamp-good-rgb))', secondary: 'rgb(var(--surface-raised-rgb))' } },
            error: { duration: 6000, iconTheme: { primary: 'rgb(var(--lamp-bad-rgb))', secondary: 'rgb(var(--surface-raised-rgb))' } },
          }}
        />
      </body>
    </html>
  );
}
