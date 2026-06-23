import Sidebar from '@/components/Sidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-navy-50">
      <Sidebar />
      <main className="relative flex-1 overflow-auto">
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
  );
}
