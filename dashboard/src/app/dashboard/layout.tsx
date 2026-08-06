import Sidebar from '@/components/Sidebar';
import { SessionProvider } from '@/lib/SessionProvider';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      {/* Nav is 13 items for staff; keyboard users need a way past it. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-700 focus:shadow-lg focus:ring-2 focus:ring-primary-500"
      >
        Skip to main content
      </a>
      <div className="flex min-h-screen bg-navy-50">
        <Sidebar />
        <main id="main-content" className="relative flex-1 overflow-auto">
          {/* Subtle top-edge gradient for depth */}
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-white to-transparent"
            aria-hidden
          />
          <div className="relative min-h-screen p-6 sm:p-8 lg:p-10">
            <div className="mx-auto max-w-7xl animate-fade-in">{children}</div>
          </div>
        </main>
      </div>
    </SessionProvider>
  );
}
