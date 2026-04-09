'use client';

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
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
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const supabase = useMemo(() => createClient(), []);

  const fetchProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    return (data as Profile | null);
  }, [supabase]);

  const fetchBranches = useCallback(async (): Promise<Branch[]> => {
    const { data } = await supabase
      .from('branches')
      .select('*')
      .eq('is_active', true)
      .order('name');
    return (data as Branch[] | null) || [];
  }, [supabase]);

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    const profileData = await fetchProfile(user.id);
    if (profileData) setProfile(profileData);
  }, [user, fetchProfile]);

  useEffect(() => {
    const init = async () => {
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();

        if (authUser) {
          setUser(authUser);
          const [profileData, branchData] = await Promise.all([
            fetchProfile(authUser.id),
            fetchBranches(),
          ]);

          if (profileData) {
            setProfile(profileData);
            // Set default selected branch
            if (profileData.role === 'owner') {
              // Owner defaults to first branch or all
              setSelectedBranch(branchData[0] || null);
            } else if (profileData.branch_id) {
              const userBranch = branchData.find(b => b.id === profileData.branch_id);
              setSelectedBranch(userBranch || null);
            }
          }
          setBranches(branchData);
        }
      } catch (error) {
        console.error('Auth init error:', error);
      } finally {
        setIsLoading(false);
      }
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          setUser(session.user);
          const [profileData, branchData] = await Promise.all([
            fetchProfile(session.user.id),
            fetchBranches(),
          ]);
          if (profileData) {
            setProfile(profileData);
            if (profileData.role === 'owner') {
              setSelectedBranch(branchData[0] || null);
            } else if (profileData.branch_id) {
              const userBranch = branchData.find(b => b.id === profileData.branch_id);
              setSelectedBranch(userBranch || null);
            }
          }
          setBranches(branchData);
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
          setProfile(null);
          setBranches([]);
          setSelectedBranch(null);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const role = profile?.role || null;

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        branches,
        selectedBranch,
        setSelectedBranch,
        isLoading,
        isOwner: role === 'owner',
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
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
