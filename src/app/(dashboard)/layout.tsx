'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { PageSkeleton } from '@/components/ui/skeleton';

// Maximum ms we'll show the loader before giving up and rendering anyway.
// Prevents the "stuck on loading" UX even if bootstrap never resolves.
const LOADING_TIMEOUT_MS = 5000;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isLoading } = useAuth();
  const [timedOut, setTimedOut] = useState(false);

  // Safety valve: if auth hasn't resolved in 5 s, render the shell anyway
  useEffect(() => {
    if (!isLoading) {
      setTimedOut(false);
      return;
    }
    const t = setTimeout(() => {
      // Auth bootstrap did not complete within the timeout.
      // This can indicate a Supabase connectivity issue or an auth regression.
      // The shell is rendered anyway to avoid the user being stuck on a spinner.
      console.error(
        '[DashboardLayout] Auth bootstrap timed out after',
        LOADING_TIMEOUT_MS,
        'ms — rendering shell without auth data. Check Supabase connectivity and auth-provider logs.'
      );
      setTimedOut(true);
    }, LOADING_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [isLoading]);

  const showLoader = isLoading && !timedOut;

  if (showLoader) {
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
          {children}
        </main>
      </div>
    </div>
  );
}
