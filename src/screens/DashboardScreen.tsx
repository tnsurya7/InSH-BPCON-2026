import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import type { StaffRole, DashboardTotals as Totals } from '@/lib/supabase';
import {
  LayoutDashboard,
  Users,
  UserPlus,
  FileSpreadsheet,
  BadgeCheck,
  QrCode,
  BarChart3,
  Settings,
  ScrollText,
  LogOut,
  ShieldCheck,
  Loader2,
  Hash,
} from 'lucide-react';
import AttendeesScreen from '@/screens/AttendeesScreen';
import SpotRegistrationScreen from '@/screens/SpotRegistrationScreen';
import CounterSettingsScreen from '@/screens/CounterSettingsScreen';
import ExcelImportScreen from '@/screens/ExcelImportScreen';
import BadgesScreen from '@/screens/BadgesScreen';
import ScannerScreen from '@/screens/ScannerScreen';
import ReportsScreen from '@/screens/ReportsScreen';
import AuditLogScreen from '@/screens/AuditLogScreen';
import StaffManagementScreen from '@/screens/StaffManagementScreen';
import BadgeLayoutEditorScreen from '@/screens/BadgeLayoutEditorScreen';

type NavItem = {
  id: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles: StaffRole[];
};

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'registration', 'scanner'] },
  { id: 'attendees', label: 'Attendees', icon: Users, roles: ['admin', 'registration'] },
  { id: 'spot', label: 'Spot Registration', icon: UserPlus, roles: ['admin', 'registration'] },
  { id: 'import', label: 'Excel Import', icon: FileSpreadsheet, roles: ['admin', 'registration'] },
  { id: 'badges', label: 'Badges', icon: BadgeCheck, roles: ['admin', 'registration'] },
  { id: 'scanner', label: 'Scanner', icon: QrCode, roles: ['admin', 'scanner'] },
  { id: 'reports', label: 'Reports', icon: BarChart3, roles: ['admin', 'registration'] },
  { id: 'audit', label: 'Audit Log', icon: ScrollText, roles: ['admin'] },
  { id: 'staff', label: 'Staff Management', icon: ShieldCheck, roles: ['admin'] },
  { id: 'counters', label: 'Registration Numbers', icon: Hash, roles: ['admin'] },
  { id: 'settings', label: 'Settings', icon: Settings, roles: ['admin'] },
];

export default function DashboardScreen() {
  const { authState, signOut } = useAuth();
  const profile =
    authState.status === 'authenticated' ? authState.profile : null;
  const role = profile?.role ?? 'scanner';

  const [activeSection, setActiveSection] = useState('dashboard');
  const [totals, setTotals] = useState<Totals | null>(null);
  const [totalsLoading, setTotalsLoading] = useState(true);

  const visibleNav = NAV_ITEMS.filter((item) => item.roles.includes(role));

  const loadTotals = useCallback(async () => {
    setTotalsLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_dashboard_totals');
      if (error) throw error;
      if (data) {
        const t = Array.isArray(data) ? data[0] : data;
        setTotals({
          total_attendees: t.total_attendees ?? 0,
          checked_in: t.checked_in ?? 0,
          checked_out: t.checked_out ?? 0,
          not_checked_in: t.not_checked_in ?? 0,
          spot: t.spot ?? 0,
          pre_registered: t.pre_registered ?? 0,
        });
      }
    } catch {
      setTotals(null);
    } finally {
      setTotalsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTotals();
  }, [loadTotals]);

  // Refresh totals when returning to dashboard from another section
  const handleSectionChange = (id: string) => {
    setActiveSection(id);
    if (id === 'dashboard') {
      loadTotals();
    }
  };

  const roleLabel = {
    admin: 'Administrator',
    registration: 'Registration',
    scanner: 'Scanner',
  }[role];

  const statCards: {
    label: string;
    value: number;
    accent: string;
    bg: string;
    icon: typeof Users;
  }[] = totals
    ? [
        { label: 'Total Attendees', value: totals.total_attendees, accent: 'text-slate-900', bg: 'bg-slate-50', icon: Users },
        { label: 'Checked In', value: totals.checked_in, accent: 'text-emerald-700', bg: 'bg-emerald-50', icon: BadgeCheck },
        { label: 'Checked Out', value: totals.checked_out, accent: 'text-amber-700', bg: 'bg-amber-50', icon: LogOut },
        { label: 'Not Checked In', value: totals.not_checked_in, accent: 'text-slate-600', bg: 'bg-slate-50', icon: UserPlus },
        { label: 'Pre-Registered', value: totals.pre_registered, accent: 'text-blue-700', bg: 'bg-blue-50', icon: FileSpreadsheet },
        { label: 'Spot Registration', value: totals.spot, accent: 'text-teal-700', bg: 'bg-teal-50', icon: UserPlus },
      ]
    : [];

  const activeNav = visibleNav.find((n) => n.id === activeSection);

  return (
    <div className="min-h-screen bg-slate-100 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col min-h-screen fixed lg:sticky top-0 h-screen z-30">
        <div className="px-5 py-5 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-teal-500 to-blue-600 flex items-center justify-center flex-shrink-0">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-white truncate">
                InSH-BPCON
              </p>
              <p className="text-[11px] text-slate-400">2026</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleSectionChange(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  active
                    ? 'bg-gradient-to-r from-teal-600 to-blue-600 text-white shadow-lg shadow-teal-900/30'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Icon className="w-4.5 h-4.5 flex-shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="px-3 py-4 border-t border-slate-800">
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-slate-800/50 mb-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-semibold text-white">
                {profile?.name?.charAt(0).toUpperCase() ?? '?'}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white truncate">
                {profile?.name}
              </p>
              <p className="text-[11px] text-slate-400">{roleLabel}</p>
            </div>
          </div>
          <button
            onClick={() => signOut()}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-20">
          <h1 className="text-lg font-bold text-slate-900">
            {activeNav?.label ?? 'Dashboard'}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {activeSection === 'dashboard'
              ? 'Conference overview with live attendance figures'
              : activeNav?.label ?? 'Conference management'}
          </p>
        </header>

        <main className="flex-1 p-6 overflow-y-auto">
          {activeSection === 'dashboard' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-base font-semibold text-slate-900 mb-1">
                  Conference Overview
                </h2>
                <p className="text-sm text-slate-500">
                  Real-time attendance figures from the database. Figures refresh
                  when you return to this page after a spot registration.
                </p>
              </div>

              {totalsLoading ? (
                <div className="flex items-center gap-2 text-slate-500 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading totals…
                </div>
              ) : totals ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {statCards.map((card) => {
                    const Icon = card.icon;
                    return (
                      <div
                        key={card.label}
                        className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow"
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div
                            className={`w-10 h-10 rounded-lg ${card.bg} flex items-center justify-center`}
                          >
                            <Icon className={`w-5 h-5 ${card.accent}`} />
                          </div>
                        </div>
                        <p className="text-3xl font-bold text-slate-900 tabular-nums">
                          {card.value}
                        </p>
                        <p className="text-sm text-slate-500 mt-1">
                          {card.label}
                        </p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Unable to load dashboard totals right now.
                </div>
              )}

              <div className="bg-white rounded-xl border border-slate-200 p-6">
                <h3 className="text-sm font-semibold text-slate-900 mb-3">
                  Status
                </h3>
                <div className="space-y-2.5 text-sm">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <span className="text-slate-600">Authentication</span>
                    <span className="inline-flex items-center gap-1.5 text-emerald-700 font-medium">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      Active
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <span className="text-slate-600">Role</span>
                    <span className="text-slate-900 font-medium">
                      {roleLabel}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Staff profile</span>
                    <span className="inline-flex items-center gap-1.5 text-emerald-700 font-medium">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      Verified
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'attendees' && <AttendeesScreen />}
          {activeSection === 'spot' && <SpotRegistrationScreen />}
          {activeSection === 'counters' && <CounterSettingsScreen />}
          {activeSection === 'import' && <ExcelImportScreen />}
          {activeSection === 'badges' && <BadgesScreen />}
          {activeSection === 'scanner' && <ScannerScreen />}
          {activeSection === 'reports' && <ReportsScreen />}
          {activeSection === 'audit' && <AuditLogScreen />}
          {activeSection === 'staff' && <StaffManagementScreen />}
          {activeSection === 'settings' && <BadgeLayoutEditorScreen />}

          {activeSection !== 'dashboard' &&
            activeSection !== 'attendees' &&
            activeSection !== 'spot' &&
            activeSection !== 'counters' &&
            activeSection !== 'import' &&
            activeSection !== 'badges' &&
            activeSection !== 'scanner' &&
            activeSection !== 'reports' &&
            activeSection !== 'audit' &&
            activeSection !== 'staff' &&
            activeSection !== 'settings' && (
              <div className="flex flex-col items-center justify-center text-center py-20">
                <div className="w-16 h-16 rounded-2xl bg-slate-200 flex items-center justify-center mb-4">
                  {(() => {
                    const Icon = activeNav?.icon ?? LayoutDashboard;
                    return <Icon className="w-8 h-8 text-slate-400" />;
                  })()}
                </div>
                <h2 className="text-lg font-semibold text-slate-900 mb-1.5">
                  {activeNav?.label ?? 'Coming soon'}
                </h2>
                <p className="text-sm text-slate-500 max-w-sm">
                  This section will be built in an upcoming phase.
                </p>
              </div>
            )}
        </main>
      </div>
    </div>
  );
}
