'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

interface AuditLogEntry {
  id: string;
  user_id: string;
  branch_id: string | null;
  action_type: string;
  entity_type: string | null;
  entity_id: string | null;
  description: string | null;
  metadata: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
  user_name?: string;
  branch_name?: string;
}

const ACTION_BADGES: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'brand' | 'default'> = {
  LOGIN: 'info',
  LOGOUT: 'default',
  CREATE: 'success',
  UPDATE: 'warning',
  DELETE: 'danger',
  SALE: 'success',
  REFUND: 'danger',
  STOCK_ADD: 'success',
  STOCK_REMOVE: 'warning',
  BULK_UPLOAD: 'brand',
};

function getActionBadgeVariant(action: string): 'success' | 'warning' | 'danger' | 'info' | 'brand' | 'default' {
  for (const [key, variant] of Object.entries(ACTION_BADGES)) {
    if (action.toUpperCase().includes(key)) return variant;
  }
  return 'default';
}

export default function AuditLogsPage() {
  const { isOwner, selectedBranch } = useAuth();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const pageSize = 50;

  // Filters
  const [filterAction, setFilterAction] = useState('');
  const [filterEntity, setFilterEntity] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [searchText, setSearchText] = useState('');

  const supabase = createClient();

  const fetchLogs = useCallback(async (pageNum: number = 0, append: boolean = false) => {
    if (!append) setIsLoading(true);

    try {
      let query = supabase
        .from('audit_logs')
        .select('*, profiles:user_id(first_name, last_name), branches:branch_id(name)')
        .order('created_at', { ascending: false })
        .range(pageNum * pageSize, (pageNum + 1) * pageSize - 1);

      if (!isOwner && selectedBranch?.id) {
        query = query.eq('branch_id', selectedBranch.id);
      }

      if (filterAction) {
        query = query.ilike('action_type', `%${filterAction}%`);
      }
      if (filterEntity) {
        query = query.ilike('entity_type', `%${filterEntity}%`);
      }
      if (filterDateFrom) {
        query = query.gte('created_at', `${filterDateFrom}T00:00:00`);
      }
      if (filterDateTo) {
        query = query.lte('created_at', `${filterDateTo}T23:59:59`);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Audit log fetch error:', error);
        return;
      }

      const mapped: AuditLogEntry[] = (data || []).map((log: Record<string, unknown>) => ({
        id: log.id as string,
        user_id: log.user_id as string,
        branch_id: log.branch_id as string | null,
        action_type: log.action_type as string,
        entity_type: log.entity_type as string | null,
        entity_id: log.entity_id as string | null,
        description: log.description as string | null,
        metadata: log.metadata as Record<string, unknown> | null,
        ip_address: log.ip_address as string | null,
        created_at: log.created_at as string,
        user_name: log.profiles
          ? `${(log.profiles as Record<string, unknown>).first_name} ${(log.profiles as Record<string, unknown>).last_name}`
          : 'System',
        branch_name: (log.branches as Record<string, unknown>)?.name as string || '—',
      }));

      setHasMore(mapped.length === pageSize);

      if (append) {
        setLogs(prev => [...prev, ...mapped]);
      } else {
        setLogs(mapped);
      }
    } catch (error) {
      console.error('Audit log error:', error);
    } finally {
      setIsLoading(false);
    }
  }, [supabase, isOwner, selectedBranch?.id, filterAction, filterEntity, filterDateFrom, filterDateTo]);

  useEffect(() => {
    setPage(0);
    fetchLogs(0);
  }, [fetchLogs]);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel('audit-log-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs' }, () => {
        fetchLogs(0);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase, fetchLogs]);

  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchLogs(nextPage, true);
  };

  const clearFilters = () => {
    setFilterAction('');
    setFilterEntity('');
    setFilterDateFrom('');
    setFilterDateTo('');
    setSearchText('');
  };

  const formatTime = (dateStr: string) =>
    new Date(dateStr).toLocaleString('en-PH', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });

  const filteredLogs = searchText
    ? logs.filter(l =>
      l.description?.toLowerCase().includes(searchText.toLowerCase()) ||
      l.user_name?.toLowerCase().includes(searchText.toLowerCase()) ||
      l.action_type.toLowerCase().includes(searchText.toLowerCase())
    )
    : logs;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-semibold text-brand-900">Audit Logs</h1>
          <p className="text-sm text-brand-500 mt-1">
            Track all system actions and changes
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-brand-400">{filteredLogs.length} entries</span>
          {(filterAction || filterEntity || filterDateFrom || filterDateTo || searchText) && (
            <button
              onClick={clearFilters}
              className="text-xs text-brand-500 hover:text-brand-700 px-2 py-1 rounded-lg hover:bg-brand-50 transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs font-medium text-brand-500 mb-1">Search</label>
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search logs..."
              className="w-full px-3 py-2 rounded-xl border border-brand-200 bg-surface-50 text-sm text-brand-800
                         placeholder:text-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-brand-500 mb-1">Action</label>
            <input
              type="text"
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
              placeholder="e.g. SALE, LOGIN"
              className="w-full px-3 py-2 rounded-xl border border-brand-200 bg-surface-50 text-sm text-brand-800
                         placeholder:text-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-brand-500 mb-1">Entity</label>
            <input
              type="text"
              value={filterEntity}
              onChange={(e) => setFilterEntity(e.target.value)}
              placeholder="e.g. sale, product"
              className="w-full px-3 py-2 rounded-xl border border-brand-200 bg-surface-50 text-sm text-brand-800
                         placeholder:text-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-brand-500 mb-1">From</label>
            <input
              type="date"
              value={filterDateFrom}
              onChange={(e) => setFilterDateFrom(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-brand-200 bg-surface-50 text-sm text-brand-800
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-brand-500 mb-1">To</label>
            <input
              type="date"
              value={filterDateTo}
              onChange={(e) => setFilterDateTo(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-brand-200 bg-surface-50 text-sm text-brand-800
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all"
            />
          </div>
        </div>
      </div>

      {/* Log Table */}
      <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-brand-100/60 bg-surface-50">
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Timestamp</th>
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">User</th>
                {isOwner && <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Branch</th>}
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Action</th>
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Entity</th>
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Description</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} className="border-b border-brand-100/30">
                    <td className="px-5 py-3"><Skeleton className="h-4 w-36" /></td>
                    <td className="px-5 py-3"><Skeleton className="h-4 w-24" /></td>
                    {isOwner && <td className="px-5 py-3"><Skeleton className="h-4 w-20" /></td>}
                    <td className="px-5 py-3"><Skeleton className="h-5 w-16 rounded-full" /></td>
                    <td className="px-5 py-3"><Skeleton className="h-4 w-16" /></td>
                    <td className="px-5 py-3"><Skeleton className="h-4 w-48" /></td>
                  </tr>
                ))
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={isOwner ? 6 : 5} className="text-center py-16 text-sm text-brand-400">
                    <svg className="w-12 h-12 text-brand-200 mx-auto mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
                    </svg>
                    No audit logs found
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="border-b border-brand-100/30 hover:bg-brand-50/30 transition-colors">
                    <td className="px-5 py-3">
                      <span className="text-xs font-mono text-brand-500">{formatTime(log.created_at)}</span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-sm text-brand-700">{log.user_name}</span>
                    </td>
                    {isOwner && (
                      <td className="px-5 py-3">
                        <span className="text-sm text-brand-500">{log.branch_name}</span>
                      </td>
                    )}
                    <td className="px-5 py-3">
                      <Badge variant={getActionBadgeVariant(log.action_type)} size="sm">
                        {log.action_type}
                      </Badge>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-xs text-brand-500 font-mono">{log.entity_type || '—'}</span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-sm text-brand-600 line-clamp-1">{log.description || '—'}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Load More */}
        {hasMore && !isLoading && filteredLogs.length > 0 && (
          <div className="p-4 border-t border-brand-100/40 text-center">
            <button
              onClick={loadMore}
              className="text-sm font-medium text-brand-600 hover:text-brand-800 px-4 py-2 rounded-xl hover:bg-brand-50 transition-colors"
            >
              Load more...
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
