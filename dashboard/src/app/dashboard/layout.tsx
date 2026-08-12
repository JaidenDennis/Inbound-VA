import Sidebar from '@/components/Sidebar';
import { SessionProvider } from '@/lib/SessionProvider';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      {/* Nav is 13 items for staff; keyboard users need a way past it. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-surface-raised focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink-800 focus:shadow-lg focus:ring-2 focus:ring-signal-600"
      >
        Skip to main content
      </a>

      <div className="flex min-h-screen bg-panel-50">
        <Sidebar />
        {/* The rail's own flex placeholder reserves its 16rem on desktop, so
            main only needs to clear the fixed mobile bar's height. */}
        <main
          id="main-content"
          className="min-w-0 flex-1 pt-14 lg:pt-0"
        >
          <div className="px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
            <div className="mx-auto max-w-[1400px]">{children}</div>
          </div>
        </main>
      </div>
    </SessionProvider>
  );
}
