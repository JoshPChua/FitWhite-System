'use client';

import { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';
import type { Profile, Branch, UserRole } from '@/types/database';

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  branches: Branch[];
  selectedBranch: Branch | null;
  setSelectedBranch: (branch: Branch) => void;
  isLoading: boolean;
  isOwner: boolean;
  isManager: boolean;
  isCashier: boolean;
  role: UserRole | null;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]               = useState<User | null>(null);
  const [profile, setProfile]         = useState<Profile | null>(null);
  const [branches, setBranches]       = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [isLoading, setIsLoading]     = useState(true);

  // Stable client reference — never recreated
  const supabase = useMemo(() => createClient(), []);

  // Guard against concurrent bootstrap calls (e.g. rapid SIGNED_IN events)
  const bootstrapInFlight = useRef(false);

  // ─── Core data-fetch helper ──────────────────────────────────
  // Deliberately NOT called inside onAuthStateChange to avoid the
  // Supabase client deadlock described here:
  // https://supabase.com/docs/guides/auth/auth-helpers/nextjs#auth-state-change
  const bootstrap = useCallback(async (authUser: User) => {
    if (bootstrapInFlight.current) return;
    bootstrapInFlight.current = true;

    try {
      const [profileRes, branchRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', authUser.id).single(),
        supabase.from('branches').select('*').eq('is_active', true).order('name'),
      ]);

      const profileData = profileRes.data as Profile | null;
      const branchData  = (branchRes.data as Branch[] | null) ?? [];

      if (profileData) {
        setProfile(profileData);

        // Set default branch without clearing it if already chosen
        setSelectedBranch(prev => {
          if (prev) return prev; // keep existing selection
          if (profileData.role === 'owner') return branchData[0] ?? null;
          return branchData.find(b => b.id === profileData.branch_id) ?? null;
        });
      }

      setBranches(branchData);
    } catch (err) {
      console.error('Auth bootstrap error:', err);
    } finally {
      bootstrapInFlight.current = false;
      setIsLoading(false);
    }
  }, [supabase]);

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    if (data) setProfile(data as Profile);
  }, [user, supabase]);

  // ─── Auth initialisation ─────────────────────────────────────
  useEffect(() => {
    // 1. Fetch current session once on mount
    supabase.auth.getUser().then(({ data: { user: authUser } }) => {
      if (authUser) {
        setUser(authUser);
        bootstrap(authUser);
      } else {
        setIsLoading(false);
      }
    });

    // 2. Listen for auth events — keep the callback SYNCHRONOUS.
    //    All async work is deferred via queueMicrotask so the Supabase
    //    client is free before we make more requests.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          // Only update user state synchronously; defer Supabase fetches
          setUser(session.user);
          setIsLoading(true);
          queueMicrotask(() => bootstrap(session.user!));

        } else if (event === 'SIGNED_OUT') {
          setUser(null);
          setProfile(null);
          setBranches([]);
          setSelectedBranch(null);
          setIsLoading(false);

        } else if (event === 'TOKEN_REFRESHED' && session?.user) {
          // Token silently refreshed — just update the user object, no re-fetch
          setUser(session.user);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, [supabase]);

  const role = profile?.role ?? null;

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        branches,
        selectedBranch,
        setSelectedBranch,
        isLoading,
        isOwner:   role === 'owner',
        isManager: role === 'manager',
        isCashier: role === 'cashier',
        role,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
