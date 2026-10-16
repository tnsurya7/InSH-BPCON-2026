import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import {
  CATEGORIES,
  ATTENDANCE_STATUSES,
  PAYMENT_STATUSES,
  type Attendee,
} from '@/lib/supabase';
import { exportAttendeesToExcel } from '@/lib/excelExport';
import Modal from '@/components/Modal';
import {
  Search,
  Download,
  Eye,
  Pencil,
  Trash2,
  Loader2,
  ChevronLeft,
  ChevronRight,
  X,
  AlertCircle,
  CheckCircle2,
  CheckSquare,
} from 'lucide-react';

const PAGE_SIZE = 20;

const CATEGORY_FILTERS = ['all', ...CATEGORIES] as const;
const REG_TYPE_FILTERS = ['all', 'pre_registered', 'spot'] as const;
const ATTENDANCE_FILTERS = ['all', ...ATTENDANCE_STATUSES] as const;
const PAYMENT_FILTERS = ['all', ...PAYMENT_STATUSES] as const;

const ATTENDANCE_LABELS: Record<string, string> = {
  not_checked_in: 'Not Checked In',
  checked_in: 'Checked In',
  checked_out: 'Checked Out',
};

const ATTENDANCE_BADGE: Record<string, string> = {
  not_checked_in: 'bg-slate-100 text-slate-700',
  checked_in: 'bg-emerald-100 text-emerald-800',
  checked_out: 'bg-amber-100 text-amber-800',
};

export default function AttendeesScreen() {
  const { authState } = useAuth();
  const role =
    authState.status === 'authenticated' ? authState.profile.role : 'scanner';
  const canManage = role === 'admin' || role === 'staff' || role === 'registration';

  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [regTypeFilter, setRegTypeFilter] = useState<string>('all');
  const [attendanceFilter, setAttendanceFilter] = useState<string>('all');
  const [paymentFilter, setPaymentFilter] = useState<string>('all');

  const [viewAttendee, setViewAttendee] = useState<Attendee | null>(null);
  const [editAttendee, setEditAttendee] = useState<Attendee | null>(null);
  const [deleteAttendee, setDeleteAttendee] = useState<Attendee | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchAttendees = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('attendees')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (debouncedSearch) {
      query = query.or(
        `name.ilike.%${debouncedSearch}%,registration_number.ilike.%${debouncedSearch}%,phone_number.ilike.%${debouncedSearch}%,email.ilike.%${debouncedSearch}%,medical_council_number.ilike.%${debouncedSearch}%`,
      );
    }
    if (categoryFilter !== 'all')
      query = query.eq('category', categoryFilter);
    if (regTypeFilter !== 'all')
      query = query.eq('registration_type', regTypeFilter);
    if (attendanceFilter !== 'all')
      query = query.eq('attendance_status', attendanceFilter);
    if (paymentFilter !== 'all')
      query = query.eq('payment_status', paymentFilter);

    query = query.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    const { data, error, count: cnt } = await query;
    if (error) {
      setActionError('Unable to load attendees. Please try again.');
      setAttendees([]);
    } else {
      setAttendees((data ?? []) as Attendee[]);
      setCount(cnt ?? 0);
      setActionError('');
    }
    setLoading(false);
  }, [
    debouncedSearch,
    categoryFilter,
    regTypeFilter,
    attendanceFilter,
    paymentFilter,
    page,
  ]);

  useEffect(() => {
    fetchAttendees();
  }, [fetchAttendees]);

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const hasActiveFilters =
    debouncedSearch !== '' ||
    categoryFilter !== 'all' ||
    regTypeFilter !== 'all' ||
    attendanceFilter !== 'all' ||
    paymentFilter !== 'all';

  const clearFilters = () => {
    setSearch('');
    setCategoryFilter('all');
    setRegTypeFilter('all');
    setAttendanceFilter('all');
    setPaymentFilter('all');
    setPage(0);
  };

  // Export all filtered results (up to 5000)
  const handleExport = async () => {
    setExporting(true);
    try {
      let query = supabase
        .from('attendees')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5000);

      if (debouncedSearch) {
        query = query.or(
          `name.ilike.%${debouncedSearch}%,registration_number.ilike.%${debouncedSearch}%,phone_number.ilike.%${debouncedSearch}%,email.ilike.%${debouncedSearch}%,medical_council_number.ilike.%${debouncedSearch}%`,
        );
      }
      if (categoryFilter !== 'all')
        query = query.eq('category', categoryFilter);
      if (regTypeFilter !== 'all')
        query = query.eq('registration_type', regTypeFilter);
      if (attendanceFilter !== 'all')
        query = query.eq('attendance_status', attendanceFilter);
      if (paymentFilter !== 'all')
        query = query.eq('payment_status', paymentFilter);

      const { data, error } = await query;
      if (error) throw error;
      exportAttendeesToExcel((data ?? []) as Attendee[]);
    } catch {
      setActionError('Excel export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const handleSaveEdit = async (updated: Partial<Attendee>) => {
    if (!editAttendee) return;
    setSaving(true);
    setActionError('');
    try {
      const patch: Record<string, unknown> = {};
      if (updated.name !== undefined) patch.name = updated.name.trim();
      if (updated.category !== undefined) patch.category = updated.category;
      if (updated.food_preference !== undefined)
        patch.food_preference = updated.food_preference;
      if (updated.payment_status !== undefined)
        patch.payment_status = updated.payment_status;
      if (updated.phone_number !== undefined)
        patch.phone_number = updated.phone_number?.trim() || null;
      if (updated.medical_council_number !== undefined)
        patch.medical_council_number = updated.medical_council_number?.trim() || null;
      if (updated.email !== undefined)
        patch.email = updated.email?.trim().toLowerCase() || null;
      if (updated.gender !== undefined)
        patch.gender = updated.gender || null;

      const { error } = await supabase
        .from('attendees')
        .update(patch)
        .eq('id', editAttendee.id);
      if (error) throw error;
      setEditAttendee(null);
      setActionSuccess('Attendee updated successfully.');
      fetchAttendees();
      // Audit: log attendee edit (safe fields only, no QR token)
      await supabase.rpc('log_audit', {
        p_action: 'attendee_updated',
        p_target_type: 'attendee',
        p_target_id: editAttendee.id,
        p_details: { registration_number: editAttendee.registration_number, changed_fields: Object.keys(patch) },
      });
      setTimeout(() => setActionSuccess(''), 3000);
    } catch {
      setActionError('Unable to update attendee. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteAttendee) return;
    setSaving(true);
    setActionError('');
    try {
      try {
        await supabase
          .from('scan_logs')
          .delete()
          .eq('attendee_id', deleteAttendee.id);
      } catch {
        // scan_logs cleanup if exists
      }

      const { error } = await supabase
        .from('attendees')
        .delete()
        .eq('id', deleteAttendee.id);
      if (error) throw error;
      const deletedReg = deleteAttendee.registration_number;
      const deletedName = deleteAttendee.name;
      setDeleteAttendee(null);
      setActionSuccess('Attendee deleted successfully.');
      fetchAttendees();
      // Audit: log attendee deletion (no PII, just identifiers)
      await supabase.rpc('log_audit', {
        p_action: 'attendee_deleted',
        p_target_type: 'attendee',
        p_target_id: deleteAttendee.id,
        p_details: { registration_number: deletedReg, name: deletedName },
      });
      setTimeout(() => setActionSuccess(''), 3000);
    } catch {
      setActionError('Unable to delete attendee. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const allCurrentPageSelected =
    attendees.length > 0 && attendees.every((a) => selectedIds.has(a.id));
  const someCurrentPageSelected =
    attendees.some((a) => selectedIds.has(a.id)) && !allCurrentPageSelected;

  const toggleSelectAllCurrentPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allCurrentPageSelected) {
        attendees.forEach((a) => next.delete(a.id));
      } else {
        attendees.forEach((a) => next.add(a.id));
      }
      return next;
    });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setSaving(true);
    setActionError('');
    try {
      const idsArray = Array.from(selectedIds);
      try {
        await supabase.from('scan_logs').delete().in('attendee_id', idsArray);
      } catch {}

      const { error } = await supabase
        .from('attendees')
        .delete()
        .in('id', idsArray);

      if (error) throw error;

      setActionSuccess(`Successfully deleted ${idsArray.length} attendee${idsArray.length === 1 ? '' : 's'}.`);
      setSelectedIds(new Set());
      setShowBulkDeleteModal(false);
      fetchAttendees();

      await supabase.rpc('log_audit', {
        p_action: 'bulk_attendees_deleted',
        p_target_type: 'attendees',
        p_target_id: null,
        p_details: { count: idsArray.length },
      });
      setTimeout(() => setActionSuccess(''), 3000);
    } catch {
      setActionError('Unable to delete selected attendees. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAll = async () => {
    setSaving(true);
    setActionError('');
    try {
      let query = supabase.from('attendees').select('id');
      if (debouncedSearch) {
        query = query.or(
          `name.ilike.%${debouncedSearch}%,registration_number.ilike.%${debouncedSearch}%,phone_number.ilike.%${debouncedSearch}%,email.ilike.%${debouncedSearch}%,medical_council_number.ilike.%${debouncedSearch}%`,
        );
      }
      if (categoryFilter !== 'all') query = query.eq('category', categoryFilter);
      if (regTypeFilter !== 'all') query = query.eq('registration_type', regTypeFilter);
      if (attendanceFilter !== 'all') query = query.eq('attendance_status', attendanceFilter);
      if (paymentFilter !== 'all') query = query.eq('payment_status', paymentFilter);

      const { data, error } = await query;
      if (error) throw error;
      const allIds = (data ?? []).map((a: { id: string }) => a.id);

      if (allIds.length > 0) {
        try {
          await supabase.from('scan_logs').delete().in('attendee_id', allIds);
        } catch {}

        const { error: delError } = await supabase
          .from('attendees')
          .delete()
          .in('id', allIds);
        if (delError) throw delError;
      }

      setActionSuccess(`Successfully deleted all ${allIds.length} attendees.`);
      setSelectedIds(new Set());
      setShowDeleteAllModal(false);
      setPage(0);
      fetchAttendees();

      await supabase.rpc('log_audit', {
        p_action: 'delete_all_attendees',
        p_target_type: 'attendees',
        p_target_id: null,
        p_details: { count: allIds.length },
      });
      setTimeout(() => setActionSuccess(''), 3000);
    } catch {
      setActionError('Failed to delete all attendees. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const selectClasses =
    'rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition';

  return (
    <div className="space-y-5">
      {/* Banner messages */}
      {actionError && (
        <div className="flex items-start gap-2.5 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-800">{actionError}</p>
        </div>
      )}
      {actionSuccess && (
        <div className="flex items-start gap-2.5 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-emerald-800">{actionSuccess}</p>
        </div>
      )}

      {/* Search + Export bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search name, registration number, phone, email, medical council no…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-300 pl-10 pr-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
          />
        </div>
        <button
          onClick={handleExport}
          disabled={exporting || count === 0}
          className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2.5 transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
        >
          {exporting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          Export Excel
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value);
            setPage(0);
          }}
          className={selectClasses}
        >
          {CATEGORY_FILTERS.map((c) => (
            <option key={c} value={c}>
              {c === 'all' ? 'All Categories' : c}
            </option>
          ))}
        </select>

        <select
          value={regTypeFilter}
          onChange={(e) => {
            setRegTypeFilter(e.target.value);
            setPage(0);
          }}
          className={selectClasses}
        >
          {REG_TYPE_FILTERS.map((r) => (
            <option key={r} value={r}>
              {r === 'all'
                ? 'All Types'
                : r === 'pre_registered'
                  ? 'Pre-Registered'
                  : 'Spot'}
            </option>
          ))}
        </select>

        <select
          value={paymentFilter}
          onChange={(e) => {
            setPaymentFilter(e.target.value);
            setPage(0);
          }}
          className={selectClasses}
        >
          {PAYMENT_FILTERS.map((p) => (
            <option key={p} value={p}>
              {p === 'all' ? 'All Payment' : p}
            </option>
          ))}
        </select>

        <select
          value={attendanceFilter}
          onChange={(e) => {
            setAttendanceFilter(e.target.value);
            setPage(0);
          }}
          className={selectClasses}
        >
          {ATTENDANCE_FILTERS.map((a) => (
            <option key={a} value={a}>
              {a === 'all' ? 'All Attendance' : ATTENDANCE_LABELS[a]}
            </option>
          ))}
        </select>

        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition"
          >
            <X className="w-4 h-4" />
            Clear
          </button>
        )}
      </div>

      {/* Bulk actions toolbar */}
      {canManage && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
              <CheckSquare className="w-4 h-4 text-teal-600" />
              {selectedIds.size > 0 ? (
                <>
                  <span className="text-teal-700 font-bold">{selectedIds.size}</span> selected
                </>
              ) : (
                'Selection'
              )}
            </span>
            {selectedIds.size > 0 && (
              <button
                onClick={deselectAll}
                className="text-xs text-slate-500 hover:text-slate-800 underline transition"
              >
                Clear Selection
              </button>
            )}
            <button
              onClick={toggleSelectAllCurrentPage}
              className="text-xs text-teal-700 hover:text-teal-900 font-medium transition"
            >
              {allCurrentPageSelected ? 'Deselect Page' : `Select All on Page (${attendees.length})`}
            </button>
          </div>

          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <button
                onClick={() => setShowBulkDeleteModal(true)}
                className="flex items-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-3.5 py-2 transition shadow-xs active:scale-[0.98]"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete Selected ({selectedIds.size})
              </button>
            )}
            {count > 0 && (
              <button
                onClick={() => setShowDeleteAllModal(true)}
                className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-medium px-3 py-2 transition"
              >
                <Trash2 className="w-3.5 h-3.5 text-red-600" />
                Delete All {hasActiveFilters ? `Filtered (${count})` : `(${count})`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left">
                {canManage && (
                  <th className="w-10 px-3 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={allCurrentPageSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someCurrentPageSelected;
                      }}
                      onChange={toggleSelectAllCurrentPage}
                      className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 w-4 h-4 cursor-pointer"
                      title={allCurrentPageSelected ? 'Deselect all on this page' : 'Select all on this page'}
                    />
                  </th>
                )}
                <th className="px-4 py-3 font-semibold text-slate-700">
                  Reg. No.
                </th>
                <th className="px-4 py-3 font-semibold text-slate-700">
                  Name
                </th>
                <th className="px-4 py-3 font-semibold text-slate-700">
                  Category
                </th>
                <th className="px-4 py-3 font-semibold text-slate-700">
                  Phone
                </th>
                <th className="px-4 py-3 font-semibold text-slate-700">
                  Email
                </th>
                <th className="px-4 py-3 font-semibold text-slate-700">
                  Gender
                </th>
                <th className="px-4 py-3 font-semibold text-slate-700">
                  Medical Council No.
                </th>
                <th className="px-4 py-3 font-semibold text-slate-700">
                  Food
                </th>
                <th className="px-4 py-3 font-semibold text-slate-700">
                  Payment
                </th>
                <th className="px-4 py-3 font-semibold text-slate-700">
                  Type
                </th>
                <th className="px-4 py-3 font-semibold text-slate-700">
                  Attendance
                </th>
                <th className="px-4 py-3 font-semibold text-slate-700">
                  Created
                </th>
                <th className="px-4 py-3 font-semibold text-slate-700 text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={canManage ? 14 : 13} className="px-4 py-12 text-center">
                    <div className="flex items-center justify-center gap-2 text-slate-500">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading attendees…
                    </div>
                  </td>
                </tr>
              ) : attendees.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 14 : 13} className="px-4 py-12 text-center text-slate-500">
                    No attendees found.
                  </td>
                </tr>
              ) : (
                attendees.map((a) => {
                  const isSelected = selectedIds.has(a.id);
                  return (
                    <tr
                      key={a.id}
                      className={
                        isSelected
                          ? 'bg-teal-50/70 hover:bg-teal-50 transition-colors'
                          : 'hover:bg-slate-50/70 transition-colors'
                      }
                    >
                      {canManage && (
                        <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(a.id)}
                            className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 w-4 h-4 cursor-pointer"
                          />
                        </td>
                      )}
                      <td className="px-4 py-3 font-mono text-xs text-slate-700 whitespace-nowrap">
                        {a.registration_number}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">
                        {a.name}
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                        {a.category}
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                        {a.phone_number ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                        {a.email ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                        {a.gender ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap font-mono text-xs">
                        {a.medical_council_number || '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                        {a.food_preference}
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                        {a.payment_status}
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                        {a.registration_type === 'spot' ? 'Spot' : 'Pre'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            ATTENDANCE_BADGE[a.attendance_status] ??
                            'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {ATTENDANCE_LABELS[a.attendance_status] ??
                            a.attendance_status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs">
                        {new Date(a.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setViewAttendee(a)}
                            title="View"
                            className="p-1.5 rounded-lg text-slate-500 hover:text-teal-700 hover:bg-teal-50 transition"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setEditAttendee(a)}
                            title="Edit"
                            className="p-1.5 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-blue-50 transition"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          {canManage && (
                            <button
                              onClick={() => setDeleteAttendee(a)}
                              title="Delete"
                              className="p-1.5 rounded-lg text-slate-500 hover:text-red-700 hover:bg-red-50 transition"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {count > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-sm text-slate-500">
            Showing {page * PAGE_SIZE + 1}–
            {Math.min((page + 1) * PAGE_SIZE, count)} of {count}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              <ChevronLeft className="w-4 h-4" />
              Prev
            </button>
            <span className="text-sm text-slate-600 tabular-nums">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* View modal */}
      <Modal
        open={!!viewAttendee}
        onClose={() => setViewAttendee(null)}
        title="Attendee Details"
      >
        {viewAttendee && <ViewDetails attendee={viewAttendee} />}
      </Modal>

      {/* Edit modal */}
      <Modal
        open={!!editAttendee}
        onClose={() => setEditAttendee(null)}
        title="Edit Attendee"
        maxWidth="max-w-xl"
      >
        {editAttendee && (
          <EditForm
            attendee={editAttendee}
            onSave={handleSaveEdit}
            onCancel={() => setEditAttendee(null)}
            saving={saving}
          />
        )}
      </Modal>

      {/* Single delete confirmation */}
      <Modal
        open={!!deleteAttendee}
        onClose={() => setDeleteAttendee(null)}
        title="Delete Attendee"
        maxWidth="max-w-md"
      >
        {deleteAttendee && (
          <div>
            <p className="text-sm text-slate-600 mb-2">
              Are you sure you want to permanently delete this attendee? This
              action cannot be undone.
            </p>
            <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 mb-5">
              <p className="font-mono text-xs text-slate-500 mb-1">
                {deleteAttendee.registration_number}
              </p>
              <p className="font-semibold text-slate-900">
                {deleteAttendee.name}
              </p>
              <p className="text-sm text-slate-600">{deleteAttendee.category}</p>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteAttendee(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-4 py-2 transition disabled:opacity-60"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Delete Permanently
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Bulk delete selected modal */}
      <Modal
        open={showBulkDeleteModal}
        onClose={() => setShowBulkDeleteModal(false)}
        title={`Delete ${selectedIds.size} Selected Attendees`}
        maxWidth="max-w-md"
      >
        <div>
          <p className="text-sm text-slate-600 mb-3">
            Are you sure you want to permanently delete{' '}
            <strong className="text-slate-900">{selectedIds.size}</strong> selected attendees?
            This will remove their attendee profiles and associated records permanently. This action cannot be undone.
          </p>

          <div className="rounded-lg bg-red-50 border border-red-200 p-3 mb-5 text-xs text-red-800">
            Warning: All selected attendees and their QR badge access will be permanently deleted.
          </div>

          <div className="flex justify-end gap-3">
            <button
              onClick={() => setShowBulkDeleteModal(false)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
            >
              Cancel
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-4 py-2 transition disabled:opacity-60 shadow-sm"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Yes, Delete {selectedIds.size} Attendees
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete all attendees modal */}
      <Modal
        open={showDeleteAllModal}
        onClose={() => setShowDeleteAllModal(false)}
        title={`Delete All ${hasActiveFilters ? `Filtered (${count})` : `(${count})`} Attendees`}
        maxWidth="max-w-md"
      >
        <div>
          <p className="text-sm text-slate-600 mb-3">
            Are you sure you want to permanently delete all{' '}
            <strong className="text-red-600 font-bold">{count}</strong> attendees{' '}
            {hasActiveFilters ? 'matching your current search and filters' : 'in the database'}?
          </p>

          <div className="rounded-lg bg-red-100 border border-red-300 p-3 mb-5 text-xs text-red-900 font-medium">
            CAUTION: This will delete all {count} attendees. This action is irreversible.
          </div>

          <div className="flex justify-end gap-3">
            <button
              onClick={() => setShowDeleteAllModal(false)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
            >
              Cancel
            </button>
            <button
              onClick={handleDeleteAll}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-4 py-2 transition disabled:opacity-60 shadow-sm"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Delete All {count} Attendees
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function ViewDetails({ attendee }: { attendee: Attendee }) {
  const rows = useMemo(
    () => [
      { label: 'Registration Number', value: attendee.registration_number },
      { label: 'Delegate Name', value: attendee.name },
      { label: 'Category', value: attendee.category },
      { label: 'Medical Council Number', value: attendee.medical_council_number ?? '—' },
      { label: 'Phone Number', value: attendee.phone_number ?? '—' },
      { label: 'Email', value: attendee.email ?? '—' },
      { label: 'Gender', value: attendee.gender ?? '—' },
      { label: 'Food Preference', value: attendee.food_preference },
      { label: 'Payment Status', value: attendee.payment_status },
      {
        label: 'Registration Type',
        value:
          attendee.registration_type === 'spot' ? 'Spot' : 'Pre-Registered',
      },
      {
        label: 'Attendance Status',
        value: ATTENDANCE_LABELS[attendee.attendance_status] ??
          attendee.attendance_status,
      },
      {
        label: 'Created Date',
        value: new Date(attendee.created_at).toLocaleString(),
      },
    ],
    [attendee],
  );

  return (
    <div className="space-y-0">
      {rows.map((r, i) => (
        <div
          key={r.label}
          className={`flex justify-between gap-4 py-2.5 text-sm ${
            i < rows.length - 1 ? 'border-b border-slate-100' : ''
          }`}
        >
          <span className="text-slate-500">{r.label}</span>
          <span className="text-slate-900 font-medium text-right">
            {r.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function EditForm({
  attendee,
  onSave,
  onCancel,
  saving,
}: {
  attendee: Attendee;
  onSave: (updated: Partial<Attendee>) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(attendee.name);
  const [category, setCategory] = useState(attendee.category);
  const [medicalCouncilNumber, setMedicalCouncilNumber] = useState(attendee.medical_council_number ?? '');
  const [foodPreference, setFoodPreference] = useState(attendee.food_preference);
  const [paymentStatus, setPaymentStatus] = useState(attendee.payment_status);
  const [phone, setPhone] = useState(attendee.phone_number ?? '');
  const [email, setEmail] = useState(attendee.email ?? '');
  const [gender, setGender] = useState(attendee.gender ?? '');
  const [formError, setFormError] = useState('');

  const inputClasses =
    'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition';
  const labelClasses = 'block text-sm font-medium text-slate-700 mb-1.5';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError('Delegate name is required.');
      return;
    }
    if (trimmedName.length > 200) {
      setFormError('Delegate name is too long (maximum 200 characters).');
      return;
    }
    const trimmedEmail = email.trim();
    if (trimmedEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedEmail.toLowerCase())) {
      setFormError('Please enter a valid email address.');
      return;
    }
    const trimmedPhone = phone.trim();
    if (trimmedPhone && !/^[0-9]{10}$/.test(trimmedPhone)) {
      setFormError('Phone number must be exactly 10 digits.');
      return;
    }

    onSave({
      name: trimmedName,
      category,
      medical_council_number: medicalCouncilNumber.trim() || undefined,
      food_preference: foodPreference,
      payment_status: paymentStatus,
      phone_number: trimmedPhone || undefined,
      email: trimmedEmail || undefined,
      gender: gender || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {formError && (
        <div className="flex items-start gap-2.5 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-800">{formError}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClasses}>Delegate Name *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClasses}
            maxLength={200}
          />
        </div>
        <div>
          <label className={labelClasses}>Medical Council Number</label>
          <input
            value={medicalCouncilNumber}
            onChange={(e) => setMedicalCouncilNumber(e.target.value)}
            className={inputClasses}
            placeholder="e.g. TNMC-12345"
            maxLength={100}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClasses}>Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={inputClasses}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClasses}>Food Preference</label>
          <select
            value={foodPreference}
            onChange={(e) => setFoodPreference(e.target.value)}
            className={inputClasses}
          >
            <option value="Vegetarian">Vegetarian</option>
            <option value="Non-Vegetarian">Non-Vegetarian</option>
            <option value="Not Specified">Not Specified</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClasses}>Payment Status *</label>
          <select
            value={paymentStatus}
            onChange={(e) => setPaymentStatus(e.target.value)}
            className={inputClasses}
          >
            {PAYMENT_STATUSES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClasses}>Gender</label>
          <select
            value={gender}
            onChange={(e) => setGender(e.target.value)}
            className={inputClasses}
          >
            <option value="">Not specified</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
            <option value="Other">Other</option>
            <option value="Prefer not to say">Prefer not to say</option>
          </select>
        </div>
      </div>

      <div>
        <label className={labelClasses}>Phone Number</label>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
          maxLength={10}
          placeholder="Enter 10-digit number"
          className={inputClasses}
        />
      </div>

      <div>
        <label className={labelClasses}>Email</label>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="optional"
          className={inputClasses}
        />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-teal-600 to-blue-600 hover:from-teal-700 hover:to-blue-700 text-white text-sm font-semibold px-4 py-2 transition disabled:opacity-60"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Save Changes
        </button>
      </div>
    </form>
  );
}
