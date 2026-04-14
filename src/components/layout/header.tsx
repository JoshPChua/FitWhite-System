'use client';

import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { Badge } from '@/components/ui/badge';
import { IMUS_ONLY, IMUS_BRANCH_CODE } from '@/lib/feature-flags';

// PH Timezone offset is UTC+8 fixed — no DST
function getPHTTime() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
}

export function Header() {
  const { profile, branches, selectedBranch, setSelectedBranch, isOwner, signOut } = useAuth();

  // In Imus-only mode, restrict the branch list to the IMS branch.
  // This is a UI-level guard — RLS enforces the restriction at the DB level.
  const visibleBranches = IMUS_ONLY
    ? branches.filter((b) => b.code === IMUS_BRANCH_CODE)
    : branches;
  const [branchOpen, setBranchOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const branchRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  // Live Philippine Time clock
  const [phtTime, setPhtTime] = useState<Date>(getPHTTime());
  useEffect(() => {
    const tick = setInterval(() => setPhtTime(getPHTTime()), 1000);
    return () => clearInterval(tick);
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (branchRef.current && !branchRef.current.contains(e.target as Node)) setBranchOpen(false);
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <header className="h-16 bg-white/80 backdrop-blur-md border-b border-brand-100/60 flex items-center justify-between px-6 sticky top-0 z-30">
      {/* Left: Philippine Date & Time */}
      <div className="flex items-center gap-3">
        <div className="hidden md:flex flex-col">
          <p className="text-xs text-brand-500 font-medium">
            {phtTime.toLocaleDateString('en-PH', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
          <p className="text-[11px] text-brand-400 tabular-nums">
            🕐&nbsp;
            {phtTime.toLocaleTimeString('en-PH', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: true,
            })}
            &nbsp;<span className="text-brand-300">PHT</span>
          </p>
        </div>
      </div>

      {/* Right: Branch selector + User */}
      <div className="flex items-center gap-3">
        {/* Branch Selector (Owner only switches branches) */}
        {isOwner && visibleBranches.length > 0 && (
          <div ref={branchRef} className="relative">
            <button
              onClick={() => setBranchOpen(!branchOpen)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl border border-brand-200 bg-surface-50 hover:bg-brand-50 transition-colors text-sm"
            >
              <svg className="w-4 h-4 text-brand-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z" />
              </svg>
              <span className="font-medium text-brand-700">{selectedBranch?.name || 'All Branches'}</span>
              <svg className={`w-3.5 h-3.5 text-brand-400 transition-transform ${branchOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </button>

            {branchOpen && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-xl border border-brand-100 shadow-dropdown animate-fade-in z-50 py-1 max-h-80 overflow-y-auto">
                {visibleBranches.map((branch) => (
                  <button
                    key={branch.id}
                    onClick={() => {
                      setSelectedBranch(branch);
                      setBranchOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors
                      ${selectedBranch?.id === branch.id ? 'bg-brand-50 text-brand-700' : 'text-brand-600 hover:bg-brand-50/60'}`}
                  >
                    <span className="font-medium">{branch.name}</span>
                    <Badge variant={branch.type === 'owned' ? 'brand' : 'info'} size="sm">
                      {branch.type}
                    </Badge>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Non-owner: Show assigned branch */}
        {!isOwner && selectedBranch && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-brand-200 bg-surface-50 text-sm">
            <svg className="w-4 h-4 text-brand-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z" />
            </svg>
            <span className="font-medium text-brand-700">{selectedBranch.name}</span>
          </div>
        )}

        {/* User menu */}
        <div ref={userRef} className="relative">
          <button
            onClick={() => setUserOpen(!userOpen)}
            className="w-9 h-9 rounded-xl bg-brand-100 flex items-center justify-center hover:bg-brand-200 transition-colors"
          >
            <span className="text-xs font-semibold text-brand-600">
              {profile?.first_name?.[0]}{profile?.last_name?.[0]}
            </span>
          </button>

          {userOpen && (
            <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl border border-brand-100 shadow-dropdown animate-fade-in z-50 py-1">
              <div className="px-4 py-2.5 border-b border-brand-100/60">
                <p className="text-sm font-medium text-brand-800">
                  {profile?.first_name} {profile?.last_name}
                </p>
                <p className="text-xs text-brand-400 capitalize">{profile?.role}</p>
              </div>
              <button
                onClick={() => { setUserOpen(false); signOut(); }}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-rose-600 hover:bg-rose-50 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                </svg>
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
