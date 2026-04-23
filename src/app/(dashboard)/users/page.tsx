'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import type { Branch, UserRole } from '@/types/database';
import { IMUS_ONLY, ENABLE_DOCTOR_COMMISSIONS } from '@/lib/feature-flags';

// ─── Types ──────────────────────────────────────────────────

interface UserProfile {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  branch_id: string | null;
  is_active: boolean;
  avatar_url: string | null;
  is_doctor: boolean;
  default_commission_rate: number | null;
  created_at: string;
  updated_at: string;
  branch_name?: string;
}

type FormMode = 'create' | 'edit';

interface UserFormData {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  branch_id: string;
  is_doctor: boolean;
  default_commission_rate: string;
}

const ROLE_CONFIG: Record<UserRole, { label: string; variant: 'brand' | 'info' | 'default' }> = {
  owner: { label: 'Owner', variant: 'brand' },
  manager: { label: 'Manager', variant: 'info' },
  cashier: { label: 'Cashier', variant: 'default' },
};

// ─── Component ──────────────────────────────────────────────

export default function UsersPage() {
  const { isOwner, isManager, profile, selectedBranch, branches, user } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [filterRole, setFilterRole] = useState<string>('');
  const [filterBranch, setFilterBranch] = useState<string>('');

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>('create');
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [formData, setFormData] = useState<UserFormData>({
    email: '',
    password: '',
    first_name: '',
    last_name: '',
    role: 'cashier',
    branch_id: '',
    is_doctor: false,
    default_commission_rate: '',
  });
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<UserProfile | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Deactivate / Activate confirmation
  const [toggleTarget, setToggleTarget] = useState<UserProfile | null>(null);
  const [isToggling, setIsToggling] = useState(false);

  const supabase = createClient();

  // ─── Fetch Users ────────────────────────────────────────────

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('profiles')
        .select('*, branches:branch_id(name)')
        .order('created_at', { ascending: false });

      // Manager only sees their branch staff
      if (isManager && selectedBranch?.id) {
        query = query.eq('branch_id', selectedBranch.id);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Fetch users error:', error);
        return;
      }

      const mapped: UserProfile[] = (data || []).map((u: Record<string, unknown>) => ({
        id: u.id as string,
        email: u.email as string,
        first_name: u.first_name as string,
        last_name: u.last_name as string,
        role: u.role as UserRole,
        branch_id: u.branch_id as string | null,
        is_active: u.is_active as boolean,
        avatar_url: u.avatar_url as string | null,
        is_doctor: (u.is_doctor as boolean) || false,
        default_commission_rate: u.default_commission_rate as number | null,
        created_at: u.created_at as string,
        updated_at: u.updated_at as string,
        branch_name: (u.branches as Record<string, unknown>)?.name as string || 'Unassigned',
      }));

      setUsers(mapped);
    } catch (err) {
      console.error('Users page error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [supabase, isManager, selectedBranch?.id]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('users-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        fetchUsers();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [supabase, fetchUsers]);

  // ─── Form Handlers ──────────────────────────────────────────

  const openCreateModal = () => {
    setFormMode('create');
    setEditingUser(null);
    setFormData({
      email: '',
      password: '',
      first_name: '',
      last_name: '',
      role: 'cashier',
      branch_id: (IMUS_ONLY || isManager) ? (selectedBranch?.id || '') : '',
      is_doctor: false,
      default_commission_rate: '',
    });
    setFormError('');
    setFormSuccess('');
    setIsModalOpen(true);
  };

  const openEditModal = (u: UserProfile) => {
    setFormMode('edit');
    setEditingUser(u);
    setFormData({
      email: u.email,
      password: '',
      first_name: u.first_name,
      last_name: u.last_name,
      role: u.role,
      branch_id: u.branch_id || '',
      is_doctor: u.is_doctor || false,
      default_commission_rate: u.default_commission_rate != null ? String(u.default_commission_rate) : '',
    });
    setFormError('');
    setFormSuccess('');
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');
    setIsSubmitting(true);

    try {
      if (formMode === 'create') {
        // Validate
        if (!formData.email || !formData.password || !formData.first_name || !formData.last_name || !formData.branch_id) {
          setFormError('All fields are required');
          return;
        }

        if (formData.password.length < 6) {
          setFormError('Password must be at least 6 characters');
          return;
        }

        const createPayload = {
          ...formData,
          is_doctor: formData.is_doctor,
          default_commission_rate: formData.default_commission_rate
            ? parseFloat(formData.default_commission_rate)
            : null,
        };

        const res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createPayload),
        });

        const result = await res.json();

        if (!res.ok) {
          setFormError(result.error || 'Failed to create user');
          return;
        }

        setFormSuccess(`Successfully created ${formData.first_name} ${formData.last_name}`);
        await fetchUsers();
        setTimeout(() => {
          setIsModalOpen(false);
          setFormSuccess('');
        }, 1500);
      } else if (formMode === 'edit' && editingUser) {
        // Build update payload (only changed fields)
        const updates: Record<string, unknown> = {};
        if (formData.first_name !== editingUser.first_name) updates.first_name = formData.first_name;
        if (formData.last_name !== editingUser.last_name) updates.last_name = formData.last_name;
        if (formData.role !== editingUser.role) updates.role = formData.role;
        if (formData.branch_id !== editingUser.branch_id) updates.branch_id = formData.branch_id;

        // Doctor fields
        if (formData.is_doctor !== (editingUser.is_doctor || false)) updates.is_doctor = formData.is_doctor;
        const parsedRate = formData.default_commission_rate ? parseFloat(formData.default_commission_rate) : null;
        if (parsedRate !== editingUser.default_commission_rate) updates.default_commission_rate = parsedRate;

        if (Object.keys(updates).length === 0) {
          setFormError('No changes detected');
          return;
        }

        const res = await fetch(`/api/users/${editingUser.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });

        const result = await res.json();

        if (!res.ok) {
          setFormError(result.error || 'Failed to update user');
          return;
        }

        setFormSuccess(`Successfully updated ${formData.first_name} ${formData.last_name}`);
        await fetchUsers();
        setTimeout(() => {
          setIsModalOpen(false);
          setFormSuccess('');
        }, 1500);
      }
    } catch (err) {
      console.error('Form submit error:', err);
      setFormError('An unexpected error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── Delete Handler ─────────────────────────────────────────

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);

    try {
      const res = await fetch(`/api/users/${deleteTarget.id}`, { method: 'DELETE' });
      const result = await res.json();

      if (!res.ok) {
        alert(result.error || 'Failed to delete user');
        return;
      }

      await fetchUsers();
    } catch (err) {
      console.error('Delete error:', err);
      alert('An unexpected error occurred while deleting');
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  };

  // ─── Toggle Active Handler ──────────────────────────────────

  const handleToggleActive = async () => {
    if (!toggleTarget) return;
    setIsToggling(true);

    try {
      const res = await fetch(`/api/users/${toggleTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !toggleTarget.is_active }),
      });

      const result = await res.json();

      if (!res.ok) {
        alert(result.error || 'Failed to update user status');
        return;
      }

      await fetchUsers();
    } catch (err) {
      console.error('Toggle error:', err);
      alert('An unexpected error occurred');
    } finally {
      setIsToggling(false);
      setToggleTarget(null);
    }
  };

  // ─── Filtered Users ─────────────────────────────────────────

  const filteredUsers = users.filter((u) => {
    const matchesSearch = !searchText || 
      `${u.first_name} ${u.last_name}`.toLowerCase().includes(searchText.toLowerCase()) ||
      u.email.toLowerCase().includes(searchText.toLowerCase());
    
    const matchesRole = !filterRole || u.role === filterRole;
    const matchesBranch = !filterBranch || u.branch_id === filterBranch;

    return matchesSearch && matchesRole && matchesBranch;
  });

  const activeCount = filteredUsers.filter(u => u.is_active).length;
  const inactiveCount = filteredUsers.filter(u => !u.is_active).length;

  // ─── Helpers ────────────────────────────────────────────────

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('en-PH', {
      month: 'short', day: 'numeric', year: 'numeric',
    });

  const canEditUser = (targetUser: UserProfile) => {
    if (isOwner) return true;
    if (isManager && targetUser.role === 'cashier' && targetUser.branch_id === selectedBranch?.id) return true;
    return false;
  };

  const canDeleteUser = (targetUser: UserProfile) => {
    if (!isOwner) return false;
    if (targetUser.id === user?.id) return false; // Can't delete self
    return true;
  };

  // Roles that the current user can assign
  const assignableRoles: UserRole[] = isOwner ? ['owner', 'manager', 'cashier'] : ['cashier'];

  // Branches the current user can assign to
  const assignableBranches: Branch[] = isOwner ? branches : branches.filter(b => b.id === selectedBranch?.id);

  const clearFilters = () => {
    setSearchText('');
    setFilterRole('');
    setFilterBranch('');
  };

  const hasFilters = searchText || filterRole || filterBranch;

  // ─── Render ─────────────────────────────────────────────────

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-semibold text-brand-900">User Management</h1>
          <p className="text-sm text-brand-500 mt-1">
            {isOwner ? 'Manage all staff across branches' : 'Manage staff in your branch'}
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 text-white text-sm font-medium
                     hover:from-brand-700 hover:to-brand-800 active:scale-[0.98] transition-all duration-200 shadow-sm hover:shadow-md"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add Staff
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-brand-400 uppercase tracking-wide">Total Staff</p>
              <p className="text-2xl font-semibold text-brand-900 mt-1">{filteredUsers.length}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center">
              <svg className="w-5 h-5 text-brand-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-brand-400 uppercase tracking-wide">Active</p>
              <p className="text-2xl font-semibold text-emerald-600 mt-1">{activeCount}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
              <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-brand-400 uppercase tracking-wide">Inactive</p>
              <p className="text-2xl font-semibold text-brand-400 mt-1">{inactiveCount}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-surface-100 flex items-center justify-center">
              <svg className="w-5 h-5 text-brand-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-brand-500 mb-1">Search</label>
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search by name or email..."
              className="w-full px-3 py-2 rounded-xl border border-brand-200 bg-surface-50 text-sm text-brand-800
                         placeholder:text-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-brand-500 mb-1">Role</label>
            <select
              value={filterRole}
              onChange={(e) => setFilterRole(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-brand-200 bg-surface-50 text-sm text-brand-800
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all"
            >
              <option value="">All roles</option>
              <option value="owner">Owner</option>
              <option value="manager">Manager</option>
              <option value="cashier">Cashier</option>
            </select>
          </div>
          {isOwner && !IMUS_ONLY && (
            <div>
              <label className="block text-xs font-medium text-brand-500 mb-1">Branch</label>
              <select
                value={filterBranch}
                onChange={(e) => setFilterBranch(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-brand-200 bg-surface-50 text-sm text-brand-800
                           focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all"
              >
                <option value="">All branches</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          )}
          {hasFilters && (
            <div className="flex items-end">
              <button
                onClick={clearFilters}
                className="text-sm text-brand-500 hover:text-brand-700 px-3 py-2 rounded-xl hover:bg-brand-50 transition-colors"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-brand-100/60 bg-surface-50">
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Staff</th>
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Email</th>
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Role</th>
                {isOwner && !IMUS_ONLY && <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Branch</th>}
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Status</th>
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Joined</th>
                <th className="text-right text-xs font-medium text-brand-400 px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-brand-100/30">
                    <td className="px-5 py-4"><div className="flex items-center gap-3"><Skeleton className="w-9 h-9 rounded-full" /><div><Skeleton className="h-4 w-28 mb-1" /><Skeleton className="h-3 w-16" /></div></div></td>
                    <td className="px-5 py-4"><Skeleton className="h-4 w-36" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-5 w-16 rounded-full" /></td>
                    {isOwner && !IMUS_ONLY && <td className="px-5 py-4"><Skeleton className="h-4 w-20" /></td>}
                    <td className="px-5 py-4"><Skeleton className="h-5 w-14 rounded-full" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-4 w-24" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-4 w-16 ml-auto" /></td>
                  </tr>
                ))
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={isOwner && !IMUS_ONLY ? 7 : 6} className="text-center py-16 text-sm text-brand-400">
                    <svg className="w-12 h-12 text-brand-200 mx-auto mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                    </svg>
                    {hasFilters ? 'No users match your filters' : 'No staff members found'}
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => (
                  <tr key={u.id} className="border-b border-brand-100/30 hover:bg-brand-50/30 transition-colors">
                    {/* Avatar + Name */}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                          u.is_active ? 'bg-brand-100' : 'bg-surface-200'
                        }`}>
                          <span className={`text-xs font-semibold ${u.is_active ? 'text-brand-600' : 'text-brand-300'}`}>
                            {u.first_name?.[0]}{u.last_name?.[0]}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className={`text-sm font-medium truncate ${u.is_active ? 'text-brand-800' : 'text-brand-400'}`}>
                            {u.first_name} {u.last_name}
                          </p>
                          {u.id === user?.id && (
                            <span className="text-[10px] text-brand-400 font-medium">(You)</span>
                          )}
                        </div>
                      </div>
                    </td>
                    {/* Email */}
                    <td className="px-5 py-4">
                      <span className="text-sm text-brand-600">{u.email}</span>
                    </td>
                    {/* Role */}
                    <td className="px-5 py-4">
                      <Badge variant={ROLE_CONFIG[u.role].variant} size="sm">
                        {ROLE_CONFIG[u.role].label}
                      </Badge>
                    </td>
                    {/* Branch (Owner only) */}
                    {isOwner && !IMUS_ONLY && (
                      <td className="px-5 py-4">
                        <span className="text-sm text-brand-500">{u.branch_name}</span>
                      </td>
                    )}
                    {/* Status */}
                    <td className="px-5 py-4">
                      <Badge variant={u.is_active ? 'success' : 'default'} size="sm">
                        {u.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    {/* Joined */}
                    <td className="px-5 py-4">
                      <span className="text-xs text-brand-400">{formatDate(u.created_at)}</span>
                    </td>
                    {/* Actions */}
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-1">
                        {canEditUser(u) && (
                          <button
                            onClick={() => openEditModal(u)}
                            className="p-2 rounded-lg text-brand-400 hover:text-brand-700 hover:bg-brand-50 transition-colors"
                            title="Edit user"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                            </svg>
                          </button>
                        )}
                        {canEditUser(u) && u.id !== user?.id && (
                          <button
                            onClick={() => setToggleTarget(u)}
                            className={`p-2 rounded-lg transition-colors ${
                              u.is_active
                                ? 'text-amber-400 hover:text-amber-700 hover:bg-amber-50'
                                : 'text-emerald-400 hover:text-emerald-700 hover:bg-emerald-50'
                            }`}
                            title={u.is_active ? 'Deactivate user' : 'Activate user'}
                          >
                            {u.is_active ? (
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                              </svg>
                            ) : (
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            )}
                          </button>
                        )}
                        {canDeleteUser(u) && (
                          <button
                            onClick={() => setDeleteTarget(u)}
                            className="p-2 rounded-lg text-rose-300 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                            title="Delete user"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                            </svg>
                          </button>
                        )}
                        {!canEditUser(u) && !canDeleteUser(u) && (
                          <span className="text-xs text-brand-300 px-2">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer count */}
        {!isLoading && filteredUsers.length > 0 && (
          <div className="px-5 py-3 border-t border-brand-100/40 text-xs text-brand-400">
            Showing {filteredUsers.length} of {users.length} staff members
          </div>
        )}
      </div>

      {/* ─── Create / Edit Modal ─────────────────────────────── */}

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={formMode === 'create' ? 'Add New Staff' : 'Edit Staff'}
        subtitle={formMode === 'create' ? 'Create a new staff account' : `Editing ${editingUser?.first_name} ${editingUser?.last_name}`}
        size="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div className="animate-slide-up bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
              {formError}
            </div>
          )}
          {formSuccess && (
            <div className="animate-slide-up bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {formSuccess}
            </div>
          )}

          {/* Name row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">First Name</label>
              <input
                type="text"
                value={formData.first_name}
                onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                placeholder="Juan"
                required
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                           focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all duration-200"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">Last Name</label>
              <input
                type="text"
                value={formData.last_name}
                onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                placeholder="Dela Cruz"
                required
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                           focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all duration-200"
              />
            </div>
          </div>

          {/* Email (only on create) */}
          {formMode === 'create' && (
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="staff@fitwhite.ph"
                required
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                           focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all duration-200"
              />
            </div>
          )}

          {/* Password (only on create) */}
          {formMode === 'create' && (
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">Password</label>
              <input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="Minimum 6 characters"
                required
                minLength={6}
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                           focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all duration-200"
              />
            </div>
          )}

          {/* Role */}
          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1.5">Role</label>
            <select
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value as UserRole })}
              required
              className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all duration-200"
            >
              {assignableRoles.map((r) => (
                <option key={r} value={r}>{ROLE_CONFIG[r].label}</option>
              ))}
            </select>
            {isManager && (
              <p className="text-xs text-brand-400 mt-1">Managers can only assign the Cashier role</p>
            )}
          </div>

          {/* Branch — hidden in IMUS_ONLY (auto-assigned) */}
          {!IMUS_ONLY && (
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">Branch</label>
              <select
                value={formData.branch_id}
                onChange={(e) => setFormData({ ...formData, branch_id: e.target.value })}
                required
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900
                           focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all duration-200"
              >
                <option value="">Select branch...</option>
                {assignableBranches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              {isManager && (
                <p className="text-xs text-brand-400 mt-1">Staff will be assigned to your branch</p>
              )}
            </div>
          )}

          {/* Doctor Fields (Phase 4) */}
          {ENABLE_DOCTOR_COMMISSIONS && (
            <div className="bg-surface-50 rounded-xl p-4 space-y-3 border border-brand-100/50">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="is_doctor"
                  checked={formData.is_doctor}
                  onChange={(e) => setFormData({ ...formData, is_doctor: e.target.checked })}
                  className="w-4 h-4 rounded border-brand-300 text-brand-600 focus:ring-brand-500"
                />
                <label htmlFor="is_doctor" className="text-sm font-medium text-brand-800">
                  This staff member is a Doctor
                </label>
              </div>
              {formData.is_doctor && (
                <div>
                  <label className="block text-sm font-medium text-brand-800 mb-1.5">Default Commission Rate</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={formData.default_commission_rate}
                      onChange={(e) => setFormData({ ...formData, default_commission_rate: e.target.value })}
                      placeholder="e.g. 30"
                      className="w-32 px-4 py-2.5 rounded-xl border border-brand-200 bg-white text-brand-900 placeholder:text-brand-300
                                 focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all duration-200"
                    />
                    <span className="text-sm text-brand-500">%</span>
                  </div>
                  <p className="text-xs text-brand-400 mt-1">Commission calculated as percentage of service gross amount</p>
                </div>
              )}
            </div>
          )}

          {/* Edit mode: show email (read-only) */}
          {formMode === 'edit' && (
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">Email</label>
              <input
                type="email"
                value={formData.email}
                disabled
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-100 text-brand-500 cursor-not-allowed transition-all duration-200"
              />
              <p className="text-xs text-brand-400 mt-1">Email cannot be changed after account creation</p>
            </div>
          )}

          {/* Submit */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 text-white font-medium
                         hover:from-brand-700 hover:to-brand-800 active:scale-[0.98]
                         disabled:opacity-60 disabled:cursor-not-allowed
                         transition-all duration-200 shadow-sm hover:shadow-md text-sm"
            >
              {isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {formMode === 'create' ? 'Creating...' : 'Saving...'}
                </span>
              ) : (
                formMode === 'create' ? 'Create Staff Account' : 'Save Changes'
              )}
            </button>
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="px-4 py-2.5 rounded-xl border border-brand-200 text-brand-600 text-sm font-medium
                         hover:bg-brand-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      {/* ─── Delete Confirmation Modal ───────────────────────── */}

      <Modal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Staff Member"
        subtitle="This action cannot be undone"
        size="sm"
      >
        <div className="space-y-4">
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <div>
                <p className="text-sm font-medium text-rose-800">
                  Permanently delete {deleteTarget?.first_name} {deleteTarget?.last_name}?
                </p>
                <p className="text-xs text-rose-600 mt-1">
                  This will remove their account, login credentials, and all associated data. This action is irreversible.
                </p>
              </div>
            </div>
          </div>

          {deleteTarget && (
            <div className="bg-surface-50 rounded-xl p-4 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-brand-400">Name</span>
                <span className="text-brand-800 font-medium">{deleteTarget.first_name} {deleteTarget.last_name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-brand-400">Email</span>
                <span className="text-brand-800">{deleteTarget.email}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-brand-400">Role</span>
                <span className="text-brand-800 capitalize">{deleteTarget.role}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-brand-400">Branch</span>
                <span className="text-brand-800">{deleteTarget.branch_name}</span>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="flex-1 py-2.5 px-4 rounded-xl bg-rose-600 text-white font-medium text-sm
                         hover:bg-rose-700 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed
                         transition-all duration-200"
            >
              {isDeleting ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Deleting...
                </span>
              ) : (
                'Delete Permanently'
              )}
            </button>
            <button
              onClick={() => setDeleteTarget(null)}
              className="px-4 py-2.5 rounded-xl border border-brand-200 text-brand-600 text-sm font-medium
                         hover:bg-brand-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      {/* ─── Toggle Active Confirmation Modal ────────────────── */}

      <Modal
        isOpen={!!toggleTarget}
        onClose={() => setToggleTarget(null)}
        title={toggleTarget?.is_active ? 'Deactivate Staff' : 'Activate Staff'}
        subtitle={toggleTarget?.is_active ? 'This will prevent them from logging in' : 'This will restore their access'}
        size="sm"
      >
        <div className="space-y-4">
          <div className={`${toggleTarget?.is_active ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'} border rounded-xl p-4`}>
            <p className={`text-sm ${toggleTarget?.is_active ? 'text-amber-800' : 'text-emerald-800'}`}>
              {toggleTarget?.is_active
                ? `Deactivating ${toggleTarget?.first_name} ${toggleTarget?.last_name} will prevent them from accessing the system. Their data will be preserved.`
                : `Reactivating ${toggleTarget?.first_name} ${toggleTarget?.last_name} will restore their access to the system.`
              }
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleToggleActive}
              disabled={isToggling}
              className={`flex-1 py-2.5 px-4 rounded-xl text-white font-medium text-sm
                         active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200
                         ${toggleTarget?.is_active
                           ? 'bg-amber-600 hover:bg-amber-700'
                           : 'bg-emerald-600 hover:bg-emerald-700'}`}
            >
              {isToggling ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Processing...
                </span>
              ) : (
                toggleTarget?.is_active ? 'Deactivate' : 'Activate'
              )}
            </button>
            <button
              onClick={() => setToggleTarget(null)}
              className="px-4 py-2.5 rounded-xl border border-brand-200 text-brand-600 text-sm font-medium
                         hover:bg-brand-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
