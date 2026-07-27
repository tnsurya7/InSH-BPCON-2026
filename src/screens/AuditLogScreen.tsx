import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import type { AuditLogEntry } from '@/lib/supabase';
import Modal from '@/components/Modal';
import {
  ScrollText,
  Loader2,
  ChevronLeft,
  ChevronRight,
  X,
  AlertCircle,
  Eye,
  Filter,
} from 'lucide-react';

const PAGE_SIZE = 25;

const ACTION_LABELS: Record<string, string> = {
  attendee_created: 'Attendee Created',
  attendee_updated: 'Attendee Updated',
  attendee_deleted: 'Attendee Deleted',
  excel_import: 'Excel Import',
  badge_print: 'Badge Print',
  badge_reprint: 'Badge Reprint',
  staff_created: 'Staff Created',
  staff_updated: 'Staff Updated',
  staff_role_changed: 'Staff Role Changed',
  staff_activated: 'Staff Activated',
  staff_deactivated: 'Staff Deactivated',
  staff_password_reset_sent: 'Password Reset Sent',
  settings_changed: 'Settings Changed',
  counter_changed: 'Counter Changed',
};

export default function AuditLogScreen() {
  const { authState } = useAuth();
  const profile =
    authState.status === 'authenticated' ? authState.profile : null;

  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);

  const [actorFilter, setActorFilter] = useState<string>('all');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [staff, setStaff] = useState<{ id: string; name: string }[]>([]);
  const [detail, setDetail] = useState<AuditLogEntry | null>(null);
  const [error, setError] = useState('');

  const loadStaff = useCallback(async () => {
    const { data } = await supabase.rpc('list_staff_with_emails');
    if (data) {
      setStaff(
        (data as { id: string; name: string }[]).map((s) => ({
          id: s.id,
          name: s.name,
        })),
      );
    }
  }, []);

  useEffect(() => {
    loadStaff();
  }, [loadStaff]);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, unknown> = {
        p_offset: page * PAGE_SIZE,
        p_limit: PAGE_SIZE,
      };
      if (actorFilter !== 'all') params.p_actor = actorFilter;
      if (actionFilter !== 'all') params.p_action = actionFilter;
      if (typeFilter !== 'all') params.p_target_type = typeFilter;
      if (fromDate) params.p_from = new Date(fromDate).toISOString();
      if (toDate) params.p_to = new Date(toDate + 'T23:59:59').toISOString();

      const countParams: Record<string, unknown> = {};
      if (actorFilter !== 'all') countParams.p_actor = actorFilter;
      if (actionFilter !== 'all') countParams.p_action = actionFilter;
      if (typeFilter !== 'all') countParams.p_target_type = typeFilter;
      if (fromDate) countParams.p_from = new Date(fromDate).toISOString();
      if (toDate) countParams.p_to = new Date(toDate + 'T23:59:59').toISOString();

      const [{ data, error: e }, { data: cnt, error: e2 }] = await Promise.all([
        supabase.rpc('get_audit_log', params),
        supabase.rpc('get_audit_log_count', countParams),
      ]);

      if (e || e2) throw e ?? e2;
      setEntries((data ?? []) as AuditLogEntry[]);
      const c = cnt as unknown as number | bigint;
      setCount(Number(c ?? 0));
    } catch {
      setError('Unable to load audit log.');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [page, actorFilter, actionFilter, typeFilter, fromDate, toDate]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const hasActiveFilters =
    actorFilter !== 'all' ||
    actionFilter !== 'all' ||
    typeFilter !== 'all' ||
    fromDate !== '' ||
    toDate !== '';

  const clearFilters = () => {
    setActorFilter('all');
    setActionFilter('all');
    setTypeFilter('all');
    setFromDate('');
    setToDate('');
    setPage(0);
  };

  const selectClasses =
    'rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition';

  const renderDetail = (d: unknown): string => {
    if (d === null || d === undefined) return '—';
    if (typeof d === 'string') return d;
    try {
      return JSON.stringify(d, null, 2);
    } catch {
      return String(d);
    }
  };

  return (
    <div className="space-y-5">
      {error && (
        <div className="flex items-start gap-2.5 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <ScrollText className="w-5 h-5 text-teal-600" />
        <div>
          <h2 className="text-base font-semibold text-slate-900">Audit Log</h2>
          <p className="text-sm text-slate-500">
            Immutable record of administrative and staff actions. Records cannot be edited or deleted.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Filter className="w-4 h-4 text-slate-400" />
        <select value={actorFilter} onChange={(e) => { setActorFilter(e.target.value); setPage(0); }} className={selectClasses}>
          <option value="all">All Staff</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setPage(0); }} className={selectClasses}>
          <option value="all">All Actions</option>
          {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }} className={selectClasses}>
          <option value="all">All Entity Types</option>
          {['attendee', 'staff', 'import_batch', 'badge', 'settings', 'counter'].map((t) => (
            <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
          ))}
        </select>
        <input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(0); }} className={selectClasses} title="From" />
        <input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(0); }} className={selectClasses} title="To" />
        {hasActiveFilters && (
          <button onClick={clearFilters} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition">
            <X className="w-4 h-4" /> Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left">
                <th className="px-4 py-3 font-semibold text-slate-700">Timestamp</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Staff Member</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Action</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Entity</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Description</th>
                <th className="px-4 py-3 font-semibold text-slate-700 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <div className="flex items-center justify-center gap-2 text-slate-500">
                      <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                    </div>
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                    No audit entries match the current filters.
                  </td>
                </tr>
              ) : (
                entries.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap text-xs">
                      {new Date(e.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">
                      {e.actor_name ?? (e.actor_id ? 'Unknown' : 'System')}
                    </td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                      {ACTION_LABELS[e.action] ?? e.action}
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      {e.target_type ? (e.target_type.charAt(0).toUpperCase() + e.target_type.slice(1)) : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {e.details && typeof e.details === 'object' && 'reason' in e.details
                        ? String((e.details as Record<string, unknown>).reason)
                        : ACTION_LABELS[e.action] ?? e.action}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setDetail(e)}
                        title="View details"
                        className="p-1.5 rounded-lg text-slate-500 hover:text-teal-700 hover:bg-teal-50 transition"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {count > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-sm text-slate-500">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, count)} of {count}
          </p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
              className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition">
              <ChevronLeft className="w-4 h-4" /> Prev
            </button>
            <span className="text-sm text-slate-600 tabular-nums">{page + 1} / {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
              className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition">
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <Modal open={!!detail} onClose={() => setDetail(null)} title="Audit Entry Details" maxWidth="max-w-lg">
        {detail && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-slate-500">Timestamp</p>
                <p className="text-slate-900 font-medium">{new Date(detail.created_at).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-slate-500">Staff Member</p>
                <p className="text-slate-900 font-medium">{detail.actor_name ?? 'System'}</p>
              </div>
              <div>
                <p className="text-slate-500">Action</p>
                <p className="text-slate-900 font-medium">{ACTION_LABELS[detail.action] ?? detail.action}</p>
              </div>
              <div>
                <p className="text-slate-500">Entity Type</p>
                <p className="text-slate-900 font-medium">{detail.target_type ?? '—'}</p>
              </div>
            </div>
            <div>
              <p className="text-sm text-slate-500 mb-1">Details (old / new values)</p>
              <pre className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs font-mono text-slate-700 overflow-x-auto max-h-64 overflow-y-auto">
                {renderDetail(detail.details)}
              </pre>
            </div>
            <p className="text-xs text-slate-400">
              Record is immutable: cannot be edited or deleted.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
