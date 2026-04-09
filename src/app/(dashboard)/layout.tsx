'use client';

import { useAuth } from '@/providers/auth-provider';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { PageSkeleton } from '@/components/ui/skeleton';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface-50 flex items-center justify-center">
        <div className="text-center animate-pulse-soft">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center mx-auto mb-3">
            <span className="text-lg font-bold text-white font-display">FW</span>
          </div>
          <p className="text-sm text-brand-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-50">
      <Sidebar />
      <div className="ml-64">
        <Header />
        <main className="p-6">
          {isLoading ? <PageSkeleton /> : children}
        </main>
      </div>
    </div>
  );
}
