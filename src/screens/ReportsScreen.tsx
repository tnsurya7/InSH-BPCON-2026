import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import {
  CATEGORIES,
  FOOD_PREFERENCES,
  PAYMENT_STATUSES,
  ATTENDANCE_STATUSES,
  type Attendee,
  type ReportTotals,
} from '@/lib/supabase';
import { exportAttendeesToExcel } from '@/lib/excelExport';
import {
  Search,
  Download,
  Loader2,
  ChevronLeft,
  ChevronRight,
  X,
  AlertCircle,
  BarChart3,
  Users,
  UserCheck,
  LogOut,
  UserPlus,
  FileSpreadsheet,
  Printer,
  ArrowRightLeft,
} from 'lucide-react';

const PAGE_SIZE = 25;

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

export default function ReportsScreen() {
  const { authState } = useAuth();
  const role =
    authState.status === 'authenticated' ? authState.profile.role : 'scanner';
  const isAdmin = role === 'admin';

  const [totals, setTotals] = useState<ReportTotals | null>(null);
  const [totalsLoading, setTotalsLoading] = useState(true);

  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [loading, setLoading] = useState(false);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [regTypeFilter, setRegTypeFilter] = useState('all');
  const [foodFilter, setFoodFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [attendanceFilter, setAttendanceFilter] = useState('all');
  const [batchFilter, setBatchFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [batches, setBatches] = useState<{ id: string; file_name: string }[]>([]);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadTotals = useCallback(async () => {
    setTotalsLoading(true);
    try {
      const { data, error: e } = await supabase.rpc('get_reports_totals');
      if (e) throw e;
      const rawData = Array.isArray(data) ? data[0] : data;
      setTotals(rawData as ReportTotals);
    } catch {
      setTotals(null);
    } finally {
      setTotalsLoading(false);
    }
  }, []);

  const loadBatches = useCallback(async () => {
    const { data } = await supabase
      .from('import_batches')
      .select('id, file_name')
      .order('created_at', { ascending: false })
      .limit(50);
    setBatches((data ?? []) as { id: string; file_name: string }[]);
  }, []);

  useEffect(() => {
    loadTotals();
    loadBatches();
  }, [loadTotals, loadBatches]);

  const buildQuery = useCallback(() => {
    let q = supabase
      .from('attendees')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (debouncedSearch) {
      q = q.or(
        `name.ilike.%${debouncedSearch}%,registration_number.ilike.%${debouncedSearch}%`,
      );
    }
    if (categoryFilter !== 'all') q = q.eq('category', categoryFilter);
    if (regTypeFilter !== 'all') q = q.eq('registration_type', regTypeFilter);
    if (foodFilter !== 'all') q = q.eq('food_preference', foodFilter);
    if (paymentFilter !== 'all') q = q.eq('payment_status', paymentFilter);
    if (attendanceFilter !== 'all') q = q.eq('attendance_status', attendanceFilter);
    if (batchFilter !== 'all') q = q.eq('import_batch_id', batchFilter);
    if (fromDate) q = q.gte('created_at', new Date(fromDate).toISOString());
    if (toDate) q = q.lte('created_at', new Date(toDate + 'T23:59:59').toISOString());
    return q;
  }, [debouncedSearch, categoryFilter, regTypeFilter, foodFilter, paymentFilter, attendanceFilter, batchFilter, fromDate, toDate]);

  const fetchPage = useCallback(async () => {
    setLoading(true);
    const q = buildQuery().range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    const { data, error: e, count: cnt } = await q;
    if (e) {
      setError('Unable to load report data.');
      setAttendees([]);
    } else {
      setAttendees((data ?? []) as Attendee[]);
      setCount(cnt ?? 0);
      setError('');
    }
    setLoading(false);
  }, [buildQuery, page]);

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const hasActiveFilters =
    debouncedSearch !== '' ||
    categoryFilter !== 'all' ||
    regTypeFilter !== 'all' ||
    foodFilter !== 'all' ||
    paymentFilter !== 'all' ||
    attendanceFilter !== 'all' ||
    batchFilter !== 'all' ||
    fromDate !== '' ||
    toDate !== '';

  const clearFilters = () => {
    setSearch('');
    setCategoryFilter('all');
    setRegTypeFilter('all');
    setFoodFilter('all');
    setPaymentFilter('all');
    setAttendanceFilter('all');
    setBatchFilter('all');
    setFromDate('');
    setToDate('');
    setPage(0);
  };

  const handleExport = async () => {
    setExporting(true);
    setError('');
    try {
      const q = buildQuery().order('created_at', { ascending: false }).limit(5000);
      const { data, error: e } = await q;
      if (e) throw e;
      // Sensitive fields (phone, email, gender) only for admin
      exportAttendeesToExcel(
        (data ?? []) as Attendee[],
        'attendee_report',
        isAdmin,
      );
    } catch {
      setError('Excel export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const selectClasses =
    'rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition';

  const summaryCards = totals
    ? [
        { label: 'Total Attendees', value: totals.total_attendees, icon: Users, bg: 'bg-slate-50', accent: 'text-slate-900' },
        { label: 'Pre-Registered', value: totals.pre_registered, icon: FileSpreadsheet, bg: 'bg-blue-50', accent: 'text-blue-700' },
        { label: 'Spot Registration', value: totals.spot, icon: UserPlus, bg: 'bg-teal-50', accent: 'text-teal-700' },
        { label: 'Checked In', value: totals.checked_in, icon: UserCheck, bg: 'bg-emerald-50', accent: 'text-emerald-700' },
        { label: 'Checked Out', value: totals.checked_out, icon: LogOut, bg: 'bg-amber-50', accent: 'text-amber-700' },
        { label: 'Not Checked In', value: totals.not_checked_in, icon: UserPlus, bg: 'bg-slate-50', accent: 'text-slate-600' },
        { label: 'Badge Prints', value: totals.badge_prints, icon: Printer, bg: 'bg-indigo-50', accent: 'text-indigo-700' },
        { label: 'Check-In Scans', value: totals.check_ins, icon: ArrowRightLeft, bg: 'bg-emerald-50', accent: 'text-emerald-700' },
        { label: 'Check-Out Scans', value: totals.check_outs, icon: ArrowRightLeft, bg: 'bg-amber-50', accent: 'text-amber-700' },
      ]
    : [];

  const renderBreakdown = (
    title: string,
    data: Record<string, number>,
  ) => (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900 mb-3">{title}</h3>
      <div className="space-y-2">
        {Object.entries(data)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => (
            <div key={k} className="flex justify-between text-sm">
              <span className="text-slate-600">{k}</span>
              <span className="font-semibold text-slate-900 tabular-nums">{v}</span>
            </div>
          ))}
        {Object.keys(data).length === 0 && (
          <p className="text-sm text-slate-400">No data</p>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-start gap-2.5 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* Summary totals */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="w-5 h-5 text-teal-600" />
          <h2 className="text-base font-semibold text-slate-900">Conference Totals</h2>
        </div>
        {totalsLoading ? (
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading totals…
          </div>
        ) : totals ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-3">
            {summaryCards.map((c) => {
              const Icon = c.icon;
              return (
                <div
                  key={c.label}
                  className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm"
                >
                  <div className={`w-9 h-9 rounded-lg ${c.bg} flex items-center justify-center mb-2.5`}>
                    <Icon className={`w-4.5 h-4.5 ${c.accent}`} />
                  </div>
                  <p className="text-2xl font-bold text-slate-900 tabular-nums">{c.value}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{c.label}</p>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Unable to load totals right now.
          </div>
        )}
      </div>

      {/* Breakdowns */}
      {totals && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {renderBreakdown('By Category', totals.by_category)}
          {renderBreakdown('By Food Preference', totals.by_food)}
          {renderBreakdown('By Payment Status', totals.by_payment)}
        </div>
      )}

      {/* Attendee report with filters */}
      <div>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <h2 className="text-base font-semibold text-slate-900">Attendee Report</h2>
          <button
            onClick={handleExport}
            disabled={exporting || count === 0}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2 transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Export Excel
          </button>
        </div>
        {!isAdmin && (
          <p className="text-xs text-slate-500 mb-3">
            Exports from your role exclude phone, email and gender per privacy policy.
          </p>
        )}

        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search name or registration number…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-300 pl-10 pr-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(0); }} className={selectClasses}>
            <option value="all">All Categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={regTypeFilter} onChange={(e) => { setRegTypeFilter(e.target.value); setPage(0); }} className={selectClasses}>
            <option value="all">All Types</option>
            <option value="pre_registered">Pre-Registered</option>
            <option value="spot">Spot</option>
          </select>
          <select value={foodFilter} onChange={(e) => { setFoodFilter(e.target.value); setPage(0); }} className={selectClasses}>
            <option value="all">All Food</option>
            {FOOD_PREFERENCES.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <select value={paymentFilter} onChange={(e) => { setPaymentFilter(e.target.value); setPage(0); }} className={selectClasses}>
            <option value="all">All Payment</option>
            {PAYMENT_STATUSES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={attendanceFilter} onChange={(e) => { setAttendanceFilter(e.target.value); setPage(0); }} className={selectClasses}>
            <option value="all">All Attendance</option>
            {ATTENDANCE_STATUSES.map((a) => <option key={a} value={a}>{ATTENDANCE_LABELS[a] ?? a}</option>)}
          </select>
          <select value={batchFilter} onChange={(e) => { setBatchFilter(e.target.value); setPage(0); }} className={selectClasses}>
            <option value="all">All Batches</option>
            {batches.map((b) => <option key={b.id} value={b.id}>{b.file_name}</option>)}
          </select>
          <input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(0); }} className={selectClasses} title="From date" />
          <input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(0); }} className={selectClasses} title="To date" />
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
                  <th className="px-4 py-3 font-semibold text-slate-700">Reg. No.</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">Name</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">Category</th>
                  {isAdmin && <th className="px-4 py-3 font-semibold text-slate-700">Phone</th>}
                  {isAdmin && <th className="px-4 py-3 font-semibold text-slate-700">Email</th>}
                  {isAdmin && <th className="px-4 py-3 font-semibold text-slate-700">Gender</th>}
                  <th className="px-4 py-3 font-semibold text-slate-700">Food</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">Payment</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">Type</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">Attendance</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={isAdmin ? 11 : 8} className="px-4 py-12 text-center">
                      <div className="flex items-center justify-center gap-2 text-slate-500">
                        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                      </div>
                    </td>
                  </tr>
                ) : attendees.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 11 : 8} className="px-4 py-12 text-center text-slate-500">
                      No attendees match the current filters.
                    </td>
                  </tr>
                ) : (
                  attendees.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-slate-700 whitespace-nowrap">{a.registration_number}</td>
                      <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">{a.name}</td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{a.category}</td>
                      {isAdmin && <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{a.phone_number ?? '—'}</td>}
                      {isAdmin && <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{a.email ?? '—'}</td>}
                      {isAdmin && <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{a.gender ?? '—'}</td>}
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{a.food_preference}</td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{a.payment_status}</td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{a.registration_type === 'spot' ? 'Spot' : 'Pre'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${ATTENDANCE_BADGE[a.attendance_status] ?? 'bg-slate-100 text-slate-700'}`}>
                          {ATTENDANCE_LABELS[a.attendance_status] ?? a.attendance_status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs">{new Date(a.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {count > 0 && (
          <div className="flex items-center justify-between flex-wrap gap-3 mt-4">
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
      </div>
    </div>
  );
}
