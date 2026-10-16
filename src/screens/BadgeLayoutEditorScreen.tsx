import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import {
  type BadgeLayout,
  type PageSizePreset,
  type SpotStickerLayout,
  type SpotStickerPreset,
  DEFAULT_BADGE_LAYOUT,
  DEFAULT_PAGE_SIZE_CONFIG,
  DEFAULT_SPOT_STICKER_LAYOUT,
  PRESET_PAGE_SIZES,
  SPOT_STICKER_PRESETS,
  loadBadgeLayout,
  saveBadgeLayout,
  validateLayout,
  BADGE_WIDTH_IN,
  BADGE_HEIGHT_IN,
  SPOT_BADGE_WIDTH_IN,
  SPOT_BADGE_HEIGHT_IN,
  centeredQrLeft,
  centeredSpotQrLeft,
  coerceSpotSticker,
  round2in,
} from '@/lib/badgeLayout';
import Badge from '@/components/Badge';
import SpotStickerBadge from '@/components/SpotStickerBadge';
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
  FileText,
  Tag,
  Sparkles,
  QrCode,
  User,
} from 'lucide-react';

const SHORT_NAME = 'Surya Kumar';
const LONG_NAME =
  'Prof. Arunachalam Krishnamurthy Subramanian Iyer PhD FRCP';
const TEST_REG = 'PMCON-2004';
const TEST_QR = 'PMCON-2004-test-token';

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
  const [previewMode, setPreviewMode] = useState<'single' | 'sheet'>('single');
  const [activeTab, setActiveTab] = useState<'standard' | 'spot_sticker'>('standard');

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
    section: keyof Omit<BadgeLayout, 'pageSize'>,
    field: string,
    value: number | string,
  ) => {
    setLayout((prev) => ({
      ...prev,
      [section]: { ...prev[section], [field]: value },
    }));
  };

  const handleSelectPreset = (preset: PageSizePreset) => {
    if (preset === 'custom') {
      setLayout((prev) => ({
        ...prev,
        pageSize: {
          preset: 'custom',
          name: 'Custom Page Size',
          width_mm: prev.pageSize?.width_mm ?? 210,
          height_mm: prev.pageSize?.height_mm ?? 297,
          columns: prev.pageSize?.columns ?? 2,
          rows: prev.pageSize?.rows ?? 2,
        },
      }));
    } else {
      setLayout((prev) => ({
        ...prev,
        pageSize: PRESET_PAGE_SIZES[preset],
      }));
    }
  };

  const updateCustomPageSize = (
    field: 'width_mm' | 'height_mm' | 'columns' | 'rows' | 'badge_width_mm' | 'badge_height_mm',
    value: number,
  ) => {
    setLayout((prev) => {
      const current = prev.pageSize ?? DEFAULT_PAGE_SIZE_CONFIG;
      return {
        ...prev,
        pageSize: {
          ...current,
          preset: 'custom',
          name: 'Custom Page Size',
          [field]: value,
        },
      };
    });
  };

  const handleSelectSpotPreset = (preset: SpotStickerPreset) => {
    if (preset === 'custom') {
      setLayout((prev) => ({
        ...prev,
        spotSticker: {
          ...(prev.spotSticker ?? DEFAULT_SPOT_STICKER_LAYOUT),
          preset: 'custom',
          name: 'Custom Spot Size',
        },
      }));
    } else {
      setLayout((prev) => ({
        ...prev,
        spotSticker: { ...SPOT_STICKER_PRESETS[preset] },
      }));
    }
  };

  const updateSpotField = (
    section: 'registration' | 'qr' | 'name_field',
    field: string,
    value: number | string,
  ) => {
    setLayout((prev) => {
      const current = coerceSpotSticker(prev.spotSticker);
      return {
        ...prev,
        spotSticker: {
          ...current,
          preset: 'custom',
          [section]: {
            ...current[section],
            [field]: value,
          },
        },
      };
    });
  };

  const updateSpotDimension = (
    field: 'width_mm' | 'height_mm',
    value: number,
  ) => {
    setLayout((prev) => {
      const current = coerceSpotSticker(prev.spotSticker);
      return {
        ...prev,
        spotSticker: {
          ...current,
          preset: 'custom',
          name: 'Custom Spot Size',
          [field]: value,
        },
      };
    });
  };

  const handleCenterSpotQr = () => {
    const current = coerceSpotSticker(layout.spotSticker);
    updateSpotField('qr', 'left', round2in(centeredSpotQrLeft(current.qr.size)));
  };

  const handlePrintTestSticker = async () => {
    setError('');
    const stickerLayout = layout.spotSticker ?? DEFAULT_SPOT_STICKER_LAYOUT;
    const attendee = makeTestAttendee(
      testName === 'short' ? SHORT_NAME : LONG_NAME,
    );

    const container = document.createElement('div');
    container.id = 'spot-sticker-test-print-root';
    document.body.appendChild(container);
    const { createRoot } = await import('react-dom/client');
    const reactEl = await import('react');
    const root = createRoot(container);
    root.render(
      reactEl.createElement(() => (
        <div>
          <style>{`
            @page {
              size: ${stickerLayout.width_mm}mm ${stickerLayout.height_mm}mm;
              margin: 0;
            }
          `}</style>
          <SpotStickerBadge attendee={attendee} layout={stickerLayout} />
        </div>
      )),
    );
    await new Promise((r) => setTimeout(r, 400));
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
      setSuccess('Badge layout and print paper size saved.');
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
    const activePage = layout.pageSize ?? DEFAULT_PAGE_SIZE_CONFIG;
    const count = (activePage.columns || 1) * (activePage.rows || 1);
    const testAttendees = Array.from({ length: count }, (_, i) => ({
      ...attendee,
      id: `test-${i + 1}`,
      registration_number: `PMCON-${2001 + i}`,
      qr_token: `PMCON-${2001 + i}-test-token`,
      name:
        i % 2 === 0
          ? testName === 'short'
            ? SHORT_NAME
            : LONG_NAME
          : testName === 'short'
          ? LONG_NAME
          : SHORT_NAME,
    }));

    // Reuse the same Badge component for printing
    const container = document.createElement('div');
    container.id = 'badge-test-print-root';
    document.body.appendChild(container);
    const { createRoot } = await import('react-dom/client');
    const reactEl = await import('react');
    const root = createRoot(container);
    root.render(
      reactEl.createElement(() => (
        <div
          className="badge-print-sheet a4-print-sheet"
          style={{
            width: `${activePage.width_mm}mm`,
            height: `${activePage.height_mm}mm`,
            maxWidth: `${activePage.width_mm}mm`,
            maxHeight: `${activePage.height_mm}mm`,
            display: 'grid',
            gridTemplateColumns: `repeat(${activePage.columns}, ${activePage.badge_width_mm || (activePage.columns === 1 ? activePage.width_mm : 105)}mm)`,
            gridTemplateRows: `repeat(${activePage.rows}, ${activePage.badge_height_mm || (activePage.rows === 1 ? activePage.height_mm : 148.5)}mm)`,
            justifyContent: 'center',
            alignContent: 'center',
            pageBreakAfter: 'always',
            breakAfter: 'page',
          }}
        >
          <style>{`
            @page {
              size: ${activePage.preset === 'A3' ? 'A3 landscape' : activePage.preset === 'A4' || activePage.preset === 'A6' ? 'A4 portrait' : `${activePage.width_mm}mm ${activePage.height_mm}mm`};
              margin: 0;
            }
          `}</style>
          {testAttendees.map((a) => (
            <Badge key={a.id} attendee={a} layout={layout} />
          ))}
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
  const activePage = layout.pageSize ?? DEFAULT_PAGE_SIZE_CONFIG;
  const spotLayout = coerceSpotSticker(layout.spotSticker);
  const badgesPerSheet = (activePage.columns || 1) * (activePage.rows || 1);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <LayoutTemplate className="w-5 h-5 text-teal-600" />
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Badge Layout &amp; Print Page Settings
          </h2>
          <p className="text-sm text-slate-500">
            Configure paper print size (A4, A3, A6, or Custom) and adjust text and QR code placement on badges.
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
      {validationError && !error && activeTab === 'standard' && (
        <div className="flex items-start gap-2.5 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">{validationError}</p>
        </div>
      )}

      {/* Tab Switcher */}
      <div className="flex border-b border-slate-200 gap-4">
        <button
          type="button"
          onClick={() => setActiveTab('standard')}
          className={`pb-3 px-1 text-sm font-semibold border-b-2 flex items-center gap-2 transition ${
            activeTab === 'standard'
              ? 'border-teal-600 text-teal-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <LayoutTemplate className="w-4 h-4" />
          Standard Badge &amp; Page Setup
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('spot_sticker')}
          className={`pb-3 px-1 text-sm font-semibold border-b-2 flex items-center gap-2 transition ${
            activeTab === 'spot_sticker'
              ? 'border-teal-600 text-teal-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Tag className="w-4 h-4" />
          Spot Sticker Badge (TVS LP 46 Neo)
        </button>
      </div>

      {activeTab === 'standard' && (
        <>
          {/* Paper / Page Size Configuration Card */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <FileText className="w-4 h-4 text-teal-600" />
              Printer Page / Paper Size
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Select standard pre-given paper sizes or specify a custom sheet size for printing badges.
            </p>
          </div>
          <span className="self-start sm:self-auto text-xs font-semibold px-3 py-1 rounded-full bg-teal-50 text-teal-700 border border-teal-200">
            {activePage.name}
          </span>
        </div>

        {/* Preset Buttons */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <button
            type="button"
            onClick={() => handleSelectPreset('A4')}
            className={`p-3.5 rounded-xl border text-left transition ${
              activePage.preset === 'A4'
                ? 'border-teal-600 bg-teal-50/70 text-teal-900 ring-2 ring-teal-500/20 shadow-sm'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            <div className="font-bold text-sm text-slate-900">A4 Page</div>
            <div className="text-xs text-slate-500 mt-0.5">210 × 297 mm</div>
            <div className="text-xs text-teal-700 font-semibold mt-1.5 flex items-center gap-1">
              <span>1 Badge per page</span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleSelectPreset('A6')}
            className={`p-3.5 rounded-xl border text-left transition ${
              activePage.preset === 'A6'
                ? 'border-teal-600 bg-teal-50/70 text-teal-900 ring-2 ring-teal-500/20 shadow-sm'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            <div className="font-bold text-sm text-slate-900">A6 (4 per page)</div>
            <div className="text-xs text-slate-500 mt-0.5">210 × 297 mm Sheet</div>
            <div className="text-xs text-teal-700 font-semibold mt-1.5 flex items-center gap-1">
              <span>4 Badges (2×2 Grid)</span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleSelectPreset('A3')}
            className={`p-3.5 rounded-xl border text-left transition ${
              activePage.preset === 'A3'
                ? 'border-teal-600 bg-teal-50/70 text-teal-900 ring-2 ring-teal-500/20 shadow-sm'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            <div className="font-bold text-sm text-slate-900">A3 Sheet</div>
            <div className="text-xs text-slate-500 mt-0.5">420 × 297 mm (Landscape)</div>
            <div className="text-xs text-teal-700 font-semibold mt-1.5 flex items-center gap-1">
              <span>8 Badges (4×2 Grid)</span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleSelectPreset('custom')}
            className={`p-3.5 rounded-xl border text-left transition ${
              activePage.preset === 'custom'
                ? 'border-teal-600 bg-teal-50/70 text-teal-900 ring-2 ring-teal-500/20 shadow-sm'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            <div className="font-bold text-sm text-slate-900">Custom Size</div>
            <div className="text-xs text-slate-500 mt-0.5">Adjustable sizes</div>
            <div className="text-xs text-teal-700 font-semibold mt-1.5 flex items-center gap-1">
              <span>Custom badge &amp; grid</span>
            </div>
          </button>
        </div>

        {/* Custom size inputs */}
        {activePage.preset === 'custom' && (
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800">
                Custom Page Dimensions, Badge Sizes &amp; Grid
              </span>
              <span className="text-xs text-slate-500">
                Configure custom sheet &amp; badge millimeter measurements
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Sheet Width (mm)
                </label>
                <input
                  type="number"
                  min={50}
                  max={1200}
                  step={1}
                  value={activePage.width_mm}
                  onChange={(e) => updateCustomPageSize('width_mm', Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Sheet Height (mm)
                </label>
                <input
                  type="number"
                  min={50}
                  max={1500}
                  step={1}
                  value={activePage.height_mm}
                  onChange={(e) => updateCustomPageSize('height_mm', Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Badge Width (mm)
                </label>
                <input
                  type="number"
                  min={30}
                  max={1200}
                  step={0.5}
                  value={activePage.badge_width_mm || 105}
                  onChange={(e) => updateCustomPageSize('badge_width_mm', Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Badge Height (mm)
                </label>
                <input
                  type="number"
                  min={30}
                  max={1500}
                  step={0.5}
                  value={activePage.badge_height_mm || 148.5}
                  onChange={(e) => updateCustomPageSize('badge_height_mm', Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Columns (across)
                </label>
                <input
                  type="number"
                  min={1}
                  max={6}
                  value={activePage.columns}
                  onChange={(e) => updateCustomPageSize('columns', Math.max(1, Number(e.target.value)))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Rows (down)
                </label>
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={activePage.rows}
                  onChange={(e) => updateCustomPageSize('rows', Math.max(1, Number(e.target.value)))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>
            <p className="text-xs text-slate-600 bg-white p-2.5 rounded-lg border border-slate-200">
              Each printed sheet will hold{' '}
              <strong className="text-slate-900">{badgesPerSheet} badge{badgesPerSheet === 1 ? '' : 's'}</strong>{' '}
              ({activePage.badge_width_mm || 105}×{activePage.badge_height_mm || 148.5} mm each) arranged in a {activePage.columns}×{activePage.rows} grid on a {activePage.width_mm}×{activePage.height_mm} mm sheet.
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Live preview */}
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-800">
              Live Preview {previewMode === 'sheet' ? `(Sheet • ${badgesPerSheet} Badges • ${activePage.columns}×${activePage.rows})` : `(Badge • ${activePage.badge_width_mm || 105}×${activePage.badge_height_mm || 148.5} mm)`}
            </h3>
            <div className="flex items-center gap-1 bg-slate-200 p-0.5 rounded-lg text-xs font-medium self-start sm:self-auto">
              <button
                type="button"
                onClick={() => setPreviewMode('single')}
                className={`px-2.5 py-1 rounded transition ${
                  previewMode === 'single'
                    ? 'bg-white text-slate-900 shadow-sm font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Single Badge
              </button>
              <button
                type="button"
                onClick={() => setPreviewMode('sheet')}
                className={`px-2.5 py-1 rounded transition ${
                  previewMode === 'sheet'
                    ? 'bg-white text-slate-900 shadow-sm font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Full Sheet ({badgesPerSheet})
              </button>
            </div>
          </div>

          <div className="bg-slate-100 rounded-xl border border-slate-200 p-4 flex flex-col items-center justify-center min-h-[380px]">
            {loading ? (
              <div className="flex items-center gap-2 text-slate-500 text-sm py-20">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading…
              </div>
            ) : previewMode === 'sheet' ? (
              (() => {
                const sheetW_px = activePage.width_mm * (96 / 25.4);
                const sheetH_px = activePage.height_mm * (96 / 25.4);
                const scale = Math.min(480 / sheetW_px, 350 / sheetH_px, 0.45);
                return (
                  <div className="space-y-2 flex flex-col items-center">
                    <div
                      style={{
                        width: `${sheetW_px * scale}px`,
                        height: `${sheetH_px * scale}px`,
                        overflow: 'hidden',
                        position: 'relative',
                        boxShadow: '0 6px 18px rgba(0, 0, 0, 0.12)',
                        borderRadius: '6px',
                        backgroundColor: '#fff',
                        border: '1px solid #cbd5e1',
                      }}
                    >
                      <div
                        style={{
                          width: `${activePage.width_mm}mm`,
                          height: `${activePage.height_mm}mm`,
                          display: 'grid',
                          gridTemplateColumns: `repeat(${activePage.columns}, ${activePage.badge_width_mm || 105}mm)`,
                          gridTemplateRows: `repeat(${activePage.rows}, ${activePage.badge_height_mm || 148.5}mm)`,
                          transform: `scale(${scale})`,
                          transformOrigin: 'top left',
                        }}
                        className="badge-print-sheet a4-print-sheet"
                      >
                        {Array.from({ length: badgesPerSheet }, (_, i) => (
                          <Badge
                            key={i}
                            attendee={{
                              ...testAttendee,
                              id: `sheet-test-${i + 1}`,
                              registration_number: `PMCON-${2001 + i}`,
                              qr_token: `PMCON-${2001 + i}-test-token`,
                              name: i % 2 === 0 ? SHORT_NAME : LONG_NAME,
                            }}
                            layout={layout}
                          />
                        ))}
                      </div>
                    </div>
                    <span className="text-[11px] text-slate-500 font-medium">
                      Sheet: {activePage.width_mm} × {activePage.height_mm} mm • {badgesPerSheet} badges ({activePage.columns} across × {activePage.rows} down)
                    </span>
                  </div>
                );
              })()
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
    </>
  )}

      {/* Spot Sticker Tab */}
      {activeTab === 'spot_sticker' && (
        <div className="space-y-6">
          {/* TVS LP 46 Neo Configuration Card */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                  <Tag className="w-4 h-4 text-teal-600" />
                  Spot Sticker Badge (TVS LP 46 Neo / Direct Thermal)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Spot badge printed on sticker paper with official background template (<code className="text-teal-700 bg-teal-50 px-1 py-0.5 rounded font-mono">Spot_Empty_sample.png</code>), crisp centered QR code, spot registration number, and attendee name.
                </p>
              </div>
              <span className="self-start sm:self-auto text-xs font-semibold px-3 py-1 rounded-full bg-teal-50 text-teal-700 border border-teal-200">
                {spotLayout.name}
              </span>
            </div>

            {/* Presets Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <button
                type="button"
                onClick={() => handleSelectSpotPreset('100x100')}
                className={`p-3.5 rounded-xl border text-left transition ${
                  spotLayout.preset === '100x100'
                    ? 'border-teal-600 bg-teal-50/70 text-teal-900 ring-2 ring-teal-500/20 shadow-sm'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <div className="font-bold text-sm text-slate-900">100 × 100 mm</div>
                <div className="text-xs text-slate-500 mt-0.5">4" × 4" Square</div>
                <div className="text-xs text-teal-700 font-semibold mt-1">Template Match</div>
              </button>

              <button
                type="button"
                onClick={() => handleSelectSpotPreset('100x75')}
                className={`p-3.5 rounded-xl border text-left transition ${
                  spotLayout.preset === '100x75'
                    ? 'border-teal-600 bg-teal-50/70 text-teal-900 ring-2 ring-teal-500/20 shadow-sm'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <div className="font-bold text-sm text-slate-900">100 × 75 mm</div>
                <div className="text-xs text-slate-500 mt-0.5">4" × 3" Standard</div>
                <div className="text-xs text-teal-700 font-semibold mt-1">Recommended Roll</div>
              </button>

              <button
                type="button"
                onClick={() => handleSelectSpotPreset('100x50')}
                className={`p-3.5 rounded-xl border text-left transition ${
                  spotLayout.preset === '100x50'
                    ? 'border-teal-600 bg-teal-50/70 text-teal-900 ring-2 ring-teal-500/20 shadow-sm'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <div className="font-bold text-sm text-slate-900">100 × 50 mm</div>
                <div className="text-xs text-slate-500 mt-0.5">4" × 2" Wide</div>
                <div className="text-xs text-teal-700 font-semibold mt-1">Wide Roll</div>
              </button>

              <button
                type="button"
                onClick={() => handleSelectSpotPreset('75x50')}
                className={`p-3.5 rounded-xl border text-left transition ${
                  spotLayout.preset === '75x50'
                    ? 'border-teal-600 bg-teal-50/70 text-teal-900 ring-2 ring-teal-500/20 shadow-sm'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <div className="font-bold text-sm text-slate-900">75 × 50 mm</div>
                <div className="text-xs text-slate-500 mt-0.5">3" × 2" Compact</div>
                <div className="text-xs text-teal-700 font-semibold mt-1">Compact Roll</div>
              </button>

              <button
                type="button"
                onClick={() => handleSelectSpotPreset('custom')}
                className={`p-3.5 rounded-xl border text-left transition ${
                  spotLayout.preset === 'custom'
                    ? 'border-teal-600 bg-teal-50/70 text-teal-900 ring-2 ring-teal-500/20 shadow-sm'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <div className="font-bold text-sm text-slate-900">Custom Size</div>
                <div className="text-xs text-slate-500 mt-0.5">Enter custom mm</div>
                <div className="text-xs text-teal-700 font-semibold mt-1">Fully Adjustable</div>
              </button>
            </div>

            {/* Custom / Fine-tuning Dimensions (mm) */}
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
              <span className="text-xs font-semibold text-slate-800 block">
                Printer Label / Paper Size (in Millimeters)
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Label Width (mm)
                  </label>
                  <input
                    type="number"
                    min={30}
                    max={200}
                    step={1}
                    value={spotLayout.width_mm}
                    onChange={(e) => updateSpotDimension('width_mm', Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">Equivalent to {(spotLayout.width_mm / 25.4).toFixed(2)} inches</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Label Height (mm)
                  </label>
                  <input
                    type="number"
                    min={20}
                    max={200}
                    step={1}
                    value={spotLayout.height_mm}
                    onChange={(e) => updateSpotDimension('height_mm', Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">Equivalent to {(spotLayout.height_mm / 25.4).toFixed(2)} inches</p>
                </div>
              </div>
            </div>
          </div>

          {/* 2-Column: Live Preview on Left, Adjustment Controls on Right */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Left Column: Preview */}
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm flex flex-col items-center lg:sticky lg:top-4">
              <div className="flex items-center justify-between w-full mb-4">
                <span className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-teal-600" />
                  Live Spot Badge Preview
                </span>
                <span className="text-xs font-mono font-bold text-teal-700 bg-teal-50 px-2.5 py-1 rounded-full border border-teal-200">
                  {spotLayout.width_mm} × {spotLayout.height_mm} mm
                </span>
              </div>

              <div className="p-4 bg-slate-100 rounded-xl border border-slate-200 shadow-inner flex items-center justify-center w-full min-h-[280px]">
                <SpotStickerBadge
                  attendee={testAttendee}
                  layout={spotLayout}
                  preview
                />
              </div>

              <div className="w-full mt-4 p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1.5">
                <div className="font-semibold text-slate-800 flex items-center justify-between">
                  <span>Badge Specifications:</span>
                  <span className="text-teal-700 font-mono text-[11px] font-bold">Spot Template</span>
                </div>
                <div>• Registration: <span className="font-mono font-bold text-slate-900">{testAttendee.registration_number}</span></div>
                <div>• Attendee: <span className="font-bold text-slate-900">{testAttendee.name.toUpperCase()}</span></div>
                <div>• Template: <span className="font-mono text-slate-700">/Spot_Empty_sample.png</span> (Auto-scaled)</div>
              </div>

              <button
                type="button"
                onClick={handlePrintTestSticker}
                className="w-full mt-4 flex items-center justify-center gap-2 rounded-xl bg-slate-900 hover:bg-black text-white text-sm font-bold py-3 transition shadow-sm"
              >
                <Printer className="w-4 h-4 text-emerald-400" />
                Print Test Spot Badge ({spotLayout.width_mm}×{spotLayout.height_mm}mm)
              </button>
            </div>

            {/* Right Column: Coordinate & Style Adjustments */}
            <div className="space-y-4">
              {/* Registration Number Section */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
                <div className={sectionTitle}>
                  <Tag className="w-4 h-4 text-teal-600" />
                  Registration Number
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <NumberField
                    label="Vertical (top)"
                    value={spotLayout.registration.top}
                    onChange={(v) => updateSpotField('registration', 'top', round2in(v))}
                    max={SPOT_BADGE_HEIGHT_IN}
                  />
                  <NumberField
                    label="Horizontal (left)"
                    value={spotLayout.registration.left}
                    onChange={(v) => updateSpotField('registration', 'left', round2in(v))}
                    max={SPOT_BADGE_WIDTH_IN}
                  />
                  <NumberField
                    label="Width"
                    value={spotLayout.registration.width}
                    onChange={(v) => updateSpotField('registration', 'width', round2in(v))}
                    max={SPOT_BADGE_WIDTH_IN}
                  />
                  <NumberField
                    label="Font size"
                    value={spotLayout.registration.fontSize}
                    onChange={(v) => updateSpotField('registration', 'fontSize', round2in(v))}
                    min={0.08}
                    max={0.5}
                  />
                  <div className="col-span-2">
                    <ColorField
                      label="Text color"
                      value={spotLayout.registration.color}
                      onChange={(v) => updateSpotField('registration', 'color', v)}
                    />
                  </div>
                </div>
              </div>

              {/* QR Code Section */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div className={sectionTitle}>
                    <QrCode className="w-4 h-4 text-teal-600" />
                    QR Code
                  </div>
                  <button
                    type="button"
                    onClick={handleCenterSpotQr}
                    className="text-xs text-teal-600 hover:text-teal-700 font-semibold px-2.5 py-1 rounded-md border border-teal-200 hover:bg-teal-50 transition"
                  >
                    Center horizontally
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <NumberField
                    label="Vertical (top)"
                    value={spotLayout.qr.top}
                    onChange={(v) => updateSpotField('qr', 'top', round2in(v))}
                    max={SPOT_BADGE_HEIGHT_IN}
                  />
                  <NumberField
                    label="Horizontal (left)"
                    value={spotLayout.qr.left}
                    onChange={(v) => updateSpotField('qr', 'left', round2in(v))}
                    max={SPOT_BADGE_WIDTH_IN}
                  />
                  <div className="col-span-2">
                    <NumberField
                      label="Size (square)"
                      value={spotLayout.qr.size}
                      onChange={(v) => updateSpotField('qr', 'size', round2in(v))}
                      min={0.8}
                      max={SPOT_BADGE_WIDTH_IN}
                    />
                  </div>
                </div>
              </div>

              {/* Delegate Name Section */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
                <div className={sectionTitle}>
                  <User className="w-4 h-4 text-teal-600" />
                  Attendee Name
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <NumberField
                    label="Vertical (top)"
                    value={spotLayout.name_field.top}
                    onChange={(v) => updateSpotField('name_field', 'top', round2in(v))}
                    max={SPOT_BADGE_HEIGHT_IN}
                  />
                  <NumberField
                    label="Horizontal (left)"
                    value={spotLayout.name_field.left}
                    onChange={(v) => updateSpotField('name_field', 'left', round2in(v))}
                    max={SPOT_BADGE_WIDTH_IN}
                  />
                  <NumberField
                    label="Width"
                    value={spotLayout.name_field.width}
                    onChange={(v) => updateSpotField('name_field', 'width', round2in(v))}
                    max={SPOT_BADGE_WIDTH_IN}
                  />
                  <NumberField
                    label="Font size"
                    value={spotLayout.name_field.fontSize}
                    onChange={(v) => updateSpotField('name_field', 'fontSize', round2in(v))}
                    min={0.08}
                    max={0.5}
                  />
                  <div className="col-span-2">
                    <ColorField
                      label="Text color"
                      value={spotLayout.name_field.color}
                      onChange={(v) => updateSpotField('name_field', 'color', v)}
                    />
                  </div>
                </div>
              </div>

              {/* Printer Setup Guidelines */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-3">
                <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Printer className="w-3.5 h-3.5 text-teal-600" />
                  Direct Thermal Printer Settings
                </h4>
                <div className="p-3 bg-teal-50/70 rounded-lg border border-teal-200 text-teal-900 text-xs space-y-1">
                  <div>• Paper Size: Select <strong>{spotLayout.width_mm} × {spotLayout.height_mm} mm</strong> in system dialog.</div>
                  <div>• Margins: Set to <strong>None (0 mm)</strong>.</div>
                  <div>• Headers &amp; Footers: <strong>Uncheck</strong>.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={saving || (activeTab === 'standard' && !!validationError)}
          className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-teal-600 to-blue-600 hover:from-teal-700 hover:to-blue-700 text-white text-sm font-semibold px-4 py-2 transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Settings
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
        {activeTab === 'standard' ? (
          <button
            onClick={handlePrintTest}
            disabled={saving || !!validationError}
            className="flex items-center gap-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-4 py-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Printer className="w-4 h-4" />
            Print Test Page ({activePage.preset === 'custom' ? 'Custom' : activePage.preset})
          </button>
        ) : (
          <button
            onClick={handlePrintTestSticker}
            className="flex items-center gap-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-4 py-2 transition"
          >
            <Printer className="w-4 h-4 text-emerald-400" />
            Print Test Sticker ({spotLayout.width_mm}×{spotLayout.height_mm}mm)
          </button>
        )}
      </div>
    </div>
  );
}
