import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import {
  type BadgeLayout,
  DEFAULT_BADGE_LAYOUT,
  loadBadgeLayout,
  saveBadgeLayout,
  validateLayout,
  BADGE_WIDTH_IN,
  BADGE_HEIGHT_IN,
  centeredQrLeft,
  round2in,
} from '@/lib/badgeLayout';
import Badge from '@/components/Badge';
import type { Attendee } from '@/lib/supabase';
import {
  LayoutTemplate,
  Save,
  RotateCcw,
  Eye,
  Printer,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Lock,
} from 'lucide-react';

const SHORT_NAME = 'Dr. Jane Smith';
const LONG_NAME =
  'Prof. Arunachalam Krishnamurthy Subramanian Iyer PhD FRCP';
const TEST_REG = 'INSH-BPCON-2026-0001';
const TEST_QR = 'INSH-BPCON-2026-0001-test-token';

function makeTestAttendee(name: string): Attendee {
  return {
    id: 'test-' + name.slice(0, 4),
    registration_number: TEST_REG,
    qr_token: TEST_QR,
    name,
    category: 'Delegates',
    phone_number: null,
    email: null,
    gender: null,
    food_preference: 'Vegetarian',
    payment_status: 'Paid',
    registration_type: 'pre_registered',
    attendance_status: 'not_checked_in',
    import_batch_id: null,
    created_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

const inputCls =
  'w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition';
const labelCls = 'block text-xs font-medium text-slate-600 mb-1';
const sectionTitle =
  'text-sm font-semibold text-slate-800 mb-2.5 flex items-center gap-1.5';

function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = BADGE_WIDTH_IN,
  step = 0.01,
  suffix = 'in',
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          className={inputCls}
        />
        {suffix && (
          <span className="text-xs text-slate-400 flex-shrink-0">{suffix}</span>
        )}
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full mt-1.5 accent-teal-600 cursor-pointer"
      />
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-9 h-9 rounded border border-slate-300 cursor-pointer p-0.5"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
          maxLength={7}
        />
      </div>
    </div>
  );
}

export default function BadgeLayoutEditorScreen() {
  const { authState } = useAuth();
  const role =
    authState.status === 'authenticated' ? authState.profile.role : 'scanner';
  const isAdmin = role === 'admin';

  const [layout, setLayout] = useState<BadgeLayout>(DEFAULT_BADGE_LAYOUT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [testName, setTestName] = useState<'short' | 'long'>('short');

  const fetchLayout = useCallback(async () => {
    setLoading(true);
    const L = await loadBadgeLayout();
    setLayout(L);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchLayout();
  }, [fetchLayout]);

  const update = (
    section: keyof BadgeLayout,
    field: string,
    value: number | string,
  ) => {
    setLayout((prev) => ({
      ...prev,
      [section]: { ...prev[section], [field]: value },
    }));
  };

  const handleSave = async () => {
    setError('');
    const vErr = validateLayout(layout);
    if (vErr) {
      setError(vErr);
      return;
    }
    setSaving(true);
    const { error: e } = await saveBadgeLayout(layout);
    setSaving(false);
    if (e) {
      setError(`Save failed: ${e}`);
    } else {
      setSuccess('Badge layout saved.');
      setTimeout(() => setSuccess(''), 4000);
      supabase.rpc('log_audit', {
        p_action: 'settings_changed',
        p_target_type: 'settings',
        p_target_id: null,
        p_details: { key: 'badge_layout' },
      });
    }
  };

  const handleReset = () => {
    setLayout({ ...DEFAULT_BADGE_LAYOUT });
    setSuccess('Reset to recommended defaults (not yet saved).');
    setTimeout(() => setSuccess(''), 3000);
  };

  const handleCenterQr = () => {
    update('qr', 'left', centeredQrLeft(layout.qr.size));
  };

  const handlePrintTest = async () => {
    setError('');
    const vErr = validateLayout(layout);
    if (vErr) {
      setError(vErr);
      return;
    }
    setSaving(true);
    const { error: e } = await saveBadgeLayout(layout);
    setSaving(false);
    if (e) {
      setError(`Cannot print: ${e}`);
      return;
    }
    const attendee = makeTestAttendee(
      testName === 'short' ? SHORT_NAME : LONG_NAME,
    );
    // Reuse the same Badge component for printing
    const container = document.createElement('div');
    container.id = 'badge-test-print-root';
    container.style.position = 'fixed';
    container.style.left = '-9999px';
    container.style.top = '0';
    document.body.appendChild(container);
    const { createRoot } = await import('react-dom/client');
    const reactEl = await import('react');
    const root = createRoot(container);
    root.render(
      reactEl.createElement(() => (
        <div className="print-test-container">
          {attendee && <Badge attendee={attendee} layout={layout} />}
        </div>
      )),
    );
    await new Promise((r) => setTimeout(r, 500));
    const onAfter = () => {
      window.removeEventListener('afterprint', onAfter);
      setTimeout(() => {
        root.unmount();
        container.remove();
      }, 200);
    };
    window.addEventListener('afterprint', onAfter);
    window.print();
  };

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-20">
        <Lock className="w-10 h-10 text-slate-300 mb-3" />
        <p className="text-sm text-slate-500">
          Only administrators can edit badge layout settings.
        </p>
      </div>
    );
  }

  const testAttendee = makeTestAttendee(
    testName === 'short' ? SHORT_NAME : LONG_NAME,
  );
  const validationError = validateLayout(layout);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <LayoutTemplate className="w-5 h-5 text-teal-600" />
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Badge Layout Editor
          </h2>
          <p className="text-sm text-slate-500">
            Adjust the position of the registration number, QR code, and
            delegate name on the 4×6 badge. The background already contains
            the "REGISTRATION NO." label — the number is placed below it.
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-2.5 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-emerald-800">{success}</p>
        </div>
      )}
      {validationError && !error && (
        <div className="flex items-start gap-2.5 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">{validationError}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Live preview */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-800">
            Live Preview (4×6 badge)
          </h3>
          <div className="bg-slate-100 rounded-xl border border-slate-200 p-4 flex justify-center">
            {loading ? (
              <div className="flex items-center gap-2 text-slate-500 text-sm py-20">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading…
              </div>
            ) : (
              <div className="shadow-lg rounded overflow-hidden">
                <Badge attendee={testAttendee} layout={layout} preview />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Test name:</span>
            <button
              onClick={() => setTestName('short')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                testName === 'short'
                  ? 'bg-teal-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Short
            </button>
            <button
              onClick={() => setTestName('long')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                testName === 'long'
                  ? 'bg-teal-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Long
            </button>
          </div>
        </div>

        {/* Controls */}
        <div className="space-y-4">
          {/* Registration */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <h3 className={sectionTitle}>
              <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
              Registration Number
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Vertical position"
                value={layout.registration.top}
                onChange={(v) => update('registration', 'top', round2in(v))}
                min={0}
                max={BADGE_HEIGHT_IN - 0.2}
              />
              <NumberField
                label="Horizontal position"
                value={layout.registration.left}
                onChange={(v) => update('registration', 'left', round2in(v))}
                min={0}
                max={BADGE_WIDTH_IN - 0.5}
              />
              <NumberField
                label="Width"
                value={layout.registration.width}
                onChange={(v) => update('registration', 'width', round2in(v))}
                min={0.5}
                max={BADGE_WIDTH_IN}
              />
              <NumberField
                label="Font size"
                value={layout.registration.fontSize}
                onChange={(v) =>
                  update('registration', 'fontSize', round2in(v))
                }
                min={0.08}
                max={0.4}
              />
              <div className="col-span-2">
                <ColorField
                  label="Text color"
                  value={layout.registration.color}
                  onChange={(v) => update('registration', 'color', v)}
                />
              </div>
            </div>
          </div>

          {/* QR code */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <h3 className={sectionTitle}>
              <span className="w-2.5 h-2.5 rounded-full bg-slate-700" />
              QR Code
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Vertical position"
                value={layout.qr.top}
                onChange={(v) => update('qr', 'top', round2in(v))}
                min={1.5}
                max={BADGE_HEIGHT_IN - 1.5}
              />
              <NumberField
                label="Horizontal position"
                value={layout.qr.left}
                onChange={(v) => update('qr', 'left', round2in(v))}
                min={0}
                max={BADGE_WIDTH_IN - 0.5}
              />
              <NumberField
                label="Size"
                value={layout.qr.size}
                onChange={(v) => update('qr', 'size', round2in(v))}
                min={0.5}
                max={2.0}
              />
              <div className="flex items-end">
                <button
                  onClick={handleCenterQr}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
                >
                  Center horizontally
                </button>
              </div>
            </div>
          </div>

          {/* Delegate name */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <h3 className={sectionTitle}>
              <span className="w-2.5 h-2.5 rounded-full bg-teal-600" />
              Delegate Name
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Vertical position"
                value={layout.name.top}
                onChange={(v) => update('name', 'top', round2in(v))}
                min={0}
                max={BADGE_HEIGHT_IN - 0.6}
              />
              <NumberField
                label="Horizontal position"
                value={layout.name.left}
                onChange={(v) => update('name', 'left', round2in(v))}
                min={0}
                max={BADGE_WIDTH_IN - 0.5}
              />
              <NumberField
                label="Width"
                value={layout.name.width}
                onChange={(v) => update('name', 'width', round2in(v))}
                min={0.5}
                max={BADGE_WIDTH_IN}
              />
              <NumberField
                label="Font size"
                value={layout.name.fontSize}
                onChange={(v) => update('name', 'fontSize', round2in(v))}
                min={0.08}
                max={0.4}
              />
              <div className="col-span-2">
                <ColorField
                  label="Text color"
                  value={layout.name.color}
                  onChange={(v) => update('name', 'color', v)}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={saving || !!validationError}
          className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-teal-600 to-blue-600 hover:from-teal-700 hover:to-blue-700 text-white text-sm font-semibold px-4 py-2 transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Layout
        </button>
        <button
          onClick={handleReset}
          className="flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
        >
          <RotateCcw className="w-4 h-4" />
          Reset to Recommended Defaults
        </button>
        <button
          onClick={() => setTestName(testName === 'short' ? 'long' : 'short')}
          className="flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
        >
          <Eye className="w-4 h-4" />
          Preview (toggle name)
        </button>
        <button
          onClick={handlePrintTest}
          disabled={saving || !!validationError}
          className="flex items-center gap-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-4 py-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Printer className="w-4 h-4" />
          Print Test Badge
        </button>
      </div>
    </div>
  );
}
