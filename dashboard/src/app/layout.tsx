import type { Metadata } from 'next';
import { Archivo, JetBrains_Mono } from 'next/font/google';
import { Toaster } from 'react-hot-toast';
import './globals.css';

// Archivo: a grotesque with the flat terminals and tight apertures of panel
// lettering, and real tabular figures. Replaces Plus Jakarta Sans, whose
// rounded humanist warmth fought the instrument reading.
const sans = Archivo({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

// Mono is reserved for measurement: counts, durations, ids, routes, stacks.
const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Gravvia Engage — AI Voice Operations',
  description:
    'Operations console for AI voice: inbound calls, lead capture, booking, and CRM synchronisation across every client.',
};

const DIRECTION_CONTRACT = `<!-- impeccable:direction seed=none-roll-unavailable
THESIS: This is a supervisory panel, not a SaaS dashboard. It refuses the
category's dark-console-with-neon-accent and its white-with-blue opposite;
state is the subject and everything else is housing.
OWN-WORLD: Cool green-grey panel housing, hairline rules, no card shadows.
Achromatic ink for every interactive atom. Chroma exists only as green/amber/red
lamps. Archivo and JetBrains Mono, tabular figures throughout.
STORY: The operator learns what is wrong before reading a word, then reaches the
failing record in one move.
FIRST VIEWPORT: Left console rail; a lamp field across the top reporting live
system state from real severity counts; the worst-first register beneath it.
FORM: Supervisory lamp field, candidate 1 of 7; concept-seed.mjs could not roll
(no ingredients catalog in this install), so the assignment was reasoned.
FINISH: unreviewed and undocumented is unfinished; this build ends with the
finish review, the verdict, and DESIGN.md
-->`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
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
            success: { iconTheme: { primary: '#1FA35F', secondary: '#fff' } },
            error: { duration: 6000, iconTheme: { primary: '#DC3B30', secondary: '#fff' } },
          }}
        />
      </body>
    </html>
  );
}
