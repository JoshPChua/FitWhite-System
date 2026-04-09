'use client';

import { useState } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { Badge } from '@/components/ui/badge';

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  manager: 'Manager',
  cashier: 'Cashier',
};

const ROLE_DESC: Record<string, string> = {
  owner: 'Full access to all branches and system settings',
  manager: 'Manage branch operations, staff, and reports',
  cashier: 'Process sales and view customers for assigned branch',
};

export default function ProfilePage() {
  const { profile, refreshProfile, selectedBranch, isOwner, isManager } = useAuth();

  // Profile form
  const [firstName, setFirstName] = useState(profile?.first_name || '');
  const [lastName, setLastName] = useState(profile?.last_name || '');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Password form
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMsg(null);
    setProfileSaving(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ first_name: firstName, last_name: lastName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setProfileMsg({ type: 'error', text: data.error });
        return;
      }
      setProfileMsg({ type: 'success', text: 'Profile updated successfully' });
      await refreshProfile();
    } catch {
      setProfileMsg({ type: 'error', text: 'Network error — please try again' });
    } finally {
      setProfileSaving(false);
    }
  };

  const handlePasswordSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMsg(null);
    if (newPassword.length < 8) {
      setPasswordMsg({ type: 'error', text: 'Password must be at least 8 characters' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: 'error', text: 'Passwords do not match' });
      return;
    }
    setPasswordSaving(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPasswordMsg({ type: 'error', text: data.error });
        return;
      }
      setPasswordMsg({ type: 'success', text: 'Password changed successfully' });
      setNewPassword(''); setConfirmPassword('');
    } catch {
      setPasswordMsg({ type: 'error', text: 'Network error — please try again' });
    } finally {
      setPasswordSaving(false);
    }
  };

  const initials = profile ? `${profile.first_name[0] || ''}${profile.last_name[0] || ''}`.toUpperCase() : '??';
  const roleVariant = profile?.role === 'owner' ? 'brand' : profile?.role === 'manager' ? 'info' : 'default';

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-display font-semibold text-brand-900">Profile Settings</h1>
        <p className="text-sm text-brand-500 mt-1">Manage your account details and security</p>
      </div>

      {/* Profile Card */}
      <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card p-6">
        <div className="flex items-center gap-4 mb-6">
          {/* Avatar */}
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-md">
              <span className="text-xl font-bold text-white">{initials}</span>
            </div>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-brand-900">{profile?.first_name} {profile?.last_name}</h2>
            <p className="text-sm text-brand-500 mt-0.5">{profile?.email}</p>
            <div className="flex items-center gap-2 mt-1.5">
              <Badge variant={roleVariant} size="sm">{ROLE_LABELS[profile?.role || 'cashier']}</Badge>
              {selectedBranch && (
                <span className="text-xs text-brand-400">· {selectedBranch.name}</span>
              )}
            </div>
          </div>
        </div>

        {/* Role info box */}
        <div className="bg-brand-50/60 rounded-xl p-4 mb-6 border border-brand-100/60">
          <div className="flex items-start gap-3">
            <svg className="w-4 h-4 text-brand-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
            <div>
              <p className="text-xs font-semibold text-brand-700">{ROLE_LABELS[profile?.role || 'cashier']} Role</p>
              <p className="text-xs text-brand-500 mt-0.5">{ROLE_DESC[profile?.role || 'cashier']}</p>
            </div>
          </div>
        </div>

        {/* Edit name form */}
        <form onSubmit={handleProfileSave} className="space-y-4">
          <h3 className="text-sm font-semibold text-brand-800">Personal Information</h3>

          {profileMsg && (
            <div className={`px-4 py-3 rounded-xl text-sm flex items-center gap-2 ${
              profileMsg.type === 'success'
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                : 'bg-red-50 border border-red-200 text-red-700'
            }`}>
              {profileMsg.type === 'success' ? (
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ) : (
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              )}
              {profileMsg.text}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">First Name</label>
              <input
                type="text" value={firstName} onChange={e => setFirstName(e.target.value)}
                required
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900
                           focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">Last Name</label>
              <input
                type="text" value={lastName} onChange={e => setLastName(e.target.value)}
                required
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900
                           focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1.5">Email Address</label>
            <input
              type="email" value={profile?.email || ''} disabled
              className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-brand-50 text-brand-500 cursor-not-allowed"
            />
            <p className="text-xs text-brand-400 mt-1">Email is managed by your administrator</p>
          </div>

          <div className="flex items-center justify-between pt-1">
            <button
              type="submit" disabled={profileSaving}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 text-white font-medium text-sm
                         hover:from-brand-700 hover:to-brand-800 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed
                         transition-all duration-200 shadow-sm"
            >
              {profileSaving ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Saving...
                </span>
              ) : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>

      {/* Password Change Card */}
      <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card p-6">
        <h3 className="text-sm font-semibold text-brand-800 mb-4">Change Password</h3>
        <form onSubmit={handlePasswordSave} className="space-y-4">
          {passwordMsg && (
            <div className={`px-4 py-3 rounded-xl text-sm flex items-center gap-2 ${
              passwordMsg.type === 'success'
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                : 'bg-red-50 border border-red-200 text-red-700'
            }`}>
              {passwordMsg.type === 'success' ? (
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ) : (
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              )}
              {passwordMsg.text}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1.5">New Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={newPassword} onChange={e => setNewPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                className="w-full px-4 py-2.5 pr-11 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                           focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all"
              />
              <button type="button" onClick={() => setShowPassword(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-400 hover:text-brand-600">
                {showPassword ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                )}
              </button>
            </div>
            {/* Strength indicator */}
            {newPassword && (
              <div className="mt-2 flex gap-1">
                {[1, 2, 3, 4].map(n => {
                  const strength = Math.min(4, Math.floor(
                    (newPassword.length >= 8 ? 1 : 0) +
                    (/[A-Z]/.test(newPassword) ? 1 : 0) +
                    (/[0-9]/.test(newPassword) ? 1 : 0) +
                    (/[^A-Za-z0-9]/.test(newPassword) ? 1 : 0)
                  ));
                  return (
                    <div key={n} className={`h-1 flex-1 rounded-full transition-colors ${
                      n <= strength
                        ? strength <= 1 ? 'bg-rose-400' : strength <= 2 ? 'bg-amber-400' : strength <= 3 ? 'bg-brand-400' : 'bg-emerald-500'
                        : 'bg-brand-100'
                    }`} />
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1.5">Confirm New Password</label>
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password"
              className={`w-full px-4 py-2.5 rounded-xl border bg-surface-50 text-brand-900 placeholder:text-brand-300
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all ${
                confirmPassword && confirmPassword !== newPassword
                  ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-400/50'
                  : 'border-brand-200 focus:border-brand-400'
              }`}
            />
            {confirmPassword && confirmPassword !== newPassword && (
              <p className="text-xs text-rose-600 mt-1">Passwords do not match</p>
            )}
          </div>

          <button
            type="submit" disabled={passwordSaving || !newPassword}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 text-white font-medium text-sm
                       hover:from-brand-700 hover:to-brand-800 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed
                       transition-all duration-200 shadow-sm"
          >
            {passwordSaving ? 'Changing...' : 'Change Password'}
          </button>
        </form>
      </div>

      {/* Account Info */}
      <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card p-6">
        <h3 className="text-sm font-semibold text-brand-800 mb-4">Account Information</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-brand-400 mb-0.5">User ID</p>
            <p className="text-brand-700 font-mono text-xs truncate">{profile?.id}</p>
          </div>
          <div>
            <p className="text-xs text-brand-400 mb-0.5">Role</p>
            <p className="text-brand-700">{ROLE_LABELS[profile?.role || 'cashier']}</p>
          </div>
          <div>
            <p className="text-xs text-brand-400 mb-0.5">Assigned Branch</p>
            <p className="text-brand-700">{isOwner ? 'All branches' : (selectedBranch?.name || '—')}</p>
          </div>
          <div>
            <p className="text-xs text-brand-400 mb-0.5">Account Status</p>
            <Badge variant={profile?.is_active ? 'success' : 'danger'} size="sm">
              {profile?.is_active ? 'Active' : 'Inactive'}
            </Badge>
          </div>
        </div>
      </div>
    </div>
  );
}
