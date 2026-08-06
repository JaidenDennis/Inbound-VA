import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import { Toaster } from 'react-hot-toast';
import './globals.css';

const sans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-sans',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Gravvia Engage — AI Voice Operations Platform',
  description: 'Enterprise AI voice operations platform for inbound calls, lead capture, booking, and CRM automation.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="font-sans antialiased">
        {children}
        {/* z-50 keeps toasts above the drawer (20) and any modal (30). */}
        <Toaster
          position="bottom-right"
          containerClassName="z-50"
          toastOptions={{
            duration: 4000,
            className: 'text-sm',
            success: { iconTheme: { primary: '#059669', secondary: '#fff' } },
            error: { duration: 6000, iconTheme: { primary: '#dc2626', secondary: '#fff' } },
          }}
        />
      </body>
    </html>
  );
}
