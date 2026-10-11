import { useState, useEffect, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import {
  CATEGORIES,
  GENDER_OPTIONS,
  PAYMENT_STATUSES,
  type SpotRegistrationResult,
  type Attendee,
} from '@/lib/supabase';
import {
  UserPlus,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Lock,
  Printer,
  Sparkles,
} from 'lucide-react';
import SpotStickerBadge from '@/components/SpotStickerBadge';
import Badge from '@/components/Badge';
import {
  loadBadgeLayout,
  type BadgeLayout,
  DEFAULT_BADGE_LAYOUT,
  DEFAULT_SPOT_STICKER_LAYOUT,
} from '@/lib/badgeLayout';

const FOOD_OPTIONS = ['Vegetarian', 'Non-Vegetarian', 'Not Specified'] as const;

export default function SpotRegistrationScreen() {
  const { authState } = useAuth();
  const role =
    authState.status === 'authenticated' ? authState.profile.role : 'scanner';

  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>('');
  const [medicalCouncilNumber, setMedicalCouncilNumber] = useState('');
  const [foodPreference, setFoodPreference] = useState<string>('');
  const [paymentStatus, setPaymentStatus] = useState<string>('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [gender, setGender] = useState('');
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState<SpotRegistrationResult | null>(null);
  const [lastRegisteredAttendee, setLastRegisteredAttendee] = useState<Attendee | null>(null);
  const [badgeLayout, setBadgeLayout] = useState<BadgeLayout>(DEFAULT_BADGE_LAYOUT);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadBadgeLayout().then(setBadgeLayout).catch(() => {});
  }, []);

  // Exhibitor may not be configured
  const [exhibitorConfigured, setExhibitorConfigured] = useState<
    boolean | null
  >(null);

  // Check exhibitor counter configuration on mount
  if (exhibitorConfigured === null && category !== 'Exhibitors') {
    setExhibitorConfigured(true);
  }

  const checkExhibitorConfig = async () => {
    const { data } = await supabase
      .from('registration_counters')
      .select('next_value, start_value')
      .eq('counter_key', 'exhibitor_counter')
      .maybeSingle() as { data: { next_value: number | null; start_value: number | null } | null };
    setExhibitorConfigured(
      data?.next_value != null && data?.start_value != null,
    );
  };

  const handleCategoryChange = (val: string) => {
    setCategory(val);
    if (val === 'Exhibitors') {
      checkExhibitorConfig();
    } else {
      setExhibitorConfigured(true);
    }
  };

  const inputClasses =
    'w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition disabled:bg-slate-100 disabled:cursor-not-allowed';
  const labelClasses = 'block text-sm font-medium text-slate-700 mb-1.5';

  const resetForm = () => {
    setName('');
    setCategory('');
    setMedicalCouncilNumber('');
    setFoodPreference('');
    setPaymentStatus('');
    setPhone('');
    setEmail('');
    setGender('');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    setFormError('');
    setSuccess(null);

    // Frontend validation
    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError('Delegate name is required.');
      return;
    }
    if (trimmedName.length > 200) {
      setFormError('Delegate name is too long (maximum 200 characters).');
      return;
    }
    if (!paymentStatus) {
      setFormError('Please select a payment status.');
      return;
    }

    const trimmedEmail = email.trim();
    if (
      trimmedEmail &&
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedEmail.toLowerCase())
    ) {
      setFormError('Please enter a valid email address.');
      return;
    }

    const trimmedPhone = phone.trim();
    if (trimmedPhone && !/^[0-9]{10}$/.test(trimmedPhone)) {
      setFormError('Phone number must be exactly 10 digits.');
      return;
    }

    const finalCategory = category.trim() || null;
    const finalFoodPreference = foodPreference || 'Not Specified';
    const trimmedMedicalCouncil = medicalCouncilNumber.trim();

    // Exhibitor config guard
    if (finalCategory === 'Exhibitors' && exhibitorConfigured === false) {
      setFormError(
        'Exhibitor registration is not yet configured. Please ask an administrator to set the starting registration number in Registration Number Settings.',
      );
      return;
    }

    setSubmitting(true);

    // Generate idempotency key — one key per submit attempt
    const idempotencyKey = `spot_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

    try {
      const { data, error } = await supabase.rpc('create_spot_registration', {
        p_name: trimmedName,
        p_category: finalCategory,
        p_food_preference: finalFoodPreference,
        p_payment_status: paymentStatus,
        p_phone_number: trimmedPhone || null,
        p_email: trimmedEmail ? trimmedEmail.toLowerCase() : null,
        p_gender: gender || null,
        p_medical_council_number: trimmedMedicalCouncil || null,
        p_idempotency_key: idempotencyKey,
      });

      if (error) {
        // Extract a user-friendly message, strip database details
        const msg = error.message;
        if (msg.includes('not yet configured')) {
          setFormError(
            'Registration is not yet configured for this category. Please contact an administrator.',
          );
        } else if (msg.includes('Permission denied')) {
          setFormError('You do not have permission to create spot registrations.');
        } else if (
          msg.includes('Delegate name is required') ||
          msg.includes('Invalid') ||
          msg.includes('too long')
        ) {
          setFormError(msg);
        } else {
          setFormError(
            'Unable to complete registration. Please check your details and try again.',
          );
        }
        return;
      }

      const rawResult = Array.isArray(data) ? data[0] : data;
      const result = rawResult as unknown as { registration_number: string; qr_token: string; attendee_id: string };
      setSuccess(result);

      const newAttendee: Attendee = {
        id: result.attendee_id,
        registration_number: result.registration_number,
        name: trimmedName,
        category: finalCategory || 'Delegate',
        food_preference: finalFoodPreference,
        payment_status: paymentStatus as any,
        phone_number: trimmedPhone || null,
        email: trimmedEmail || null,
        gender: gender || null,
        medical_council_number: trimmedMedicalCouncil || null,
        qr_token: result.qr_token,
        registration_type: 'spot',
        attendance_status: 'not_checked_in',
        import_batch_id: null,
        created_by: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setLastRegisteredAttendee(newAttendee);

      resetForm();
      // Audit: log attendee creation (no QR token or PII in details)
      await supabase.rpc('log_audit', {
        p_action: 'attendee_created',
        p_target_type: 'attendee',
        p_target_id: result.attendee_id,
        p_details: {
          registration_number: result.registration_number,
          name: trimmedName,
          category: finalCategory,
          medical_council_number: trimmedMedicalCouncil || undefined,
          registration_type: 'spot',
        },
      });
    } catch {
      setFormError(
        'A network error occurred. Please check your connection and try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handlePrintSticker = async () => {
    if (!lastRegisteredAttendee) return;
    const stickerLayout = badgeLayout.spotSticker ?? DEFAULT_SPOT_STICKER_LAYOUT;
    const container = document.createElement('div');
    container.id = 'spot-sticker-print-root';
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
          <SpotStickerBadge attendee={lastRegisteredAttendee} layout={stickerLayout} />
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

  const handlePrintStandard = async () => {
    if (!lastRegisteredAttendee) return;
    const activePage = badgeLayout.pageSize ?? DEFAULT_BADGE_LAYOUT.pageSize!;
    const container = document.createElement('div');
    container.id = 'standard-badge-print-root';
    document.body.appendChild(container);

    const { createRoot } = await import('react-dom/client');
    const reactEl = await import('react');
    const root = createRoot(container);
    root.render(
      reactEl.createElement(() => (
        <div
          className="a4-print-sheet"
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
              size: ${activePage.width_mm}mm ${activePage.height_mm}mm;
              margin: 0;
            }
          `}</style>
          <Badge attendee={lastRegisteredAttendee} layout={badgeLayout} />
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

  // Scanner role check — RLS + UI both block
  if (role === 'scanner') {
    return (
      <div className="flex flex-col items-center justify-center text-center py-20">
        <div className="w-16 h-16 rounded-2xl bg-red-100 flex items-center justify-center mb-4">
          <Lock className="w-8 h-8 text-red-600" />
        </div>
        <h2 className="text-lg font-semibold text-slate-900 mb-1.5">
          Access Restricted
        </h2>
        <p className="text-sm text-slate-500 max-w-sm">
          Scanner accounts cannot access spot registration. This restriction is
          enforced by both the interface and database security policies.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h2 className="text-base font-semibold text-slate-900 mb-1">
          Spot Registration
        </h2>
        <p className="text-sm text-slate-500">
          Register a new attendee on-site. Unique spot registration numbers (PMCON-5000+ series) and sticker badges for TVS LP 46 Neo are generated instantly.
        </p>
      </div>

      {success && lastRegisteredAttendee && (
        <div className="rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm space-y-5 animate-in fade-in duration-200">
          <div className="flex items-start justify-between gap-4 pb-4 border-b border-emerald-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Spot Registration Successful!
                </h3>
                <p className="text-xs text-slate-500">
                  Unique spot delegate registered. Ready for immediate thermal badge printing.
                </p>
              </div>
            </div>
            <div className="text-right">
              <span className="font-mono text-sm font-extrabold px-3 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200">
                {lastRegisteredAttendee.registration_number}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
            {/* Spot Sticker Preview Card */}
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 flex flex-col items-center">
              <div className="flex items-center justify-between w-full mb-3">
                <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-teal-600" />
                  TVS LP 46 Neo Sticker Preview
                </span>
                <span className="text-[11px] font-mono text-slate-500">
                  {(badgeLayout.spotSticker ?? DEFAULT_SPOT_STICKER_LAYOUT).width_mm}×
                  {(badgeLayout.spotSticker ?? DEFAULT_SPOT_STICKER_LAYOUT).height_mm} mm
                </span>
              </div>
              <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-inner flex items-center justify-center">
                <SpotStickerBadge
                  attendee={lastRegisteredAttendee}
                  layout={badgeLayout.spotSticker}
                  preview
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-2 text-center">
                Pure white background • Centered QR • Bold uppercase text
              </p>
            </div>

            {/* Attendee Details & Actions */}
            <div className="space-y-4">
              <div className="space-y-2 text-sm text-slate-700 bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div>
                  <span className="text-xs text-slate-400 block">Delegate Name</span>
                  <span className="font-bold text-slate-900 text-base">{lastRegisteredAttendee.name}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-200">
                  <div>
                    <span className="text-xs text-slate-400 block">Category</span>
                    <span className="font-medium text-slate-800">{lastRegisteredAttendee.category}</span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-400 block">Food</span>
                    <span className="font-medium text-slate-800">{lastRegisteredAttendee.food_preference}</span>
                  </div>
                </div>
                {lastRegisteredAttendee.medical_council_number && (
                  <div className="pt-1 border-t border-slate-200">
                    <span className="text-xs text-slate-400 block">Medical Council No.</span>
                    <span className="font-medium text-slate-800">{lastRegisteredAttendee.medical_council_number}</span>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={handlePrintSticker}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-slate-900 hover:bg-black text-white text-sm font-bold px-4 py-3 shadow-md hover:shadow-lg transition"
                >
                  <Printer className="w-4 h-4 text-emerald-400" />
                  Print Sticker Badge (TVS LP 46 Neo)
                </button>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handlePrintStandard}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold px-3 py-2 transition"
                  >
                    <Printer className="w-3.5 h-3.5 text-slate-500" />
                    Print Standard Badge
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSuccess(null);
                      setLastRegisteredAttendee(null);
                    }}
                    className="flex-1 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 text-xs font-semibold px-3 py-2 transition"
                  >
                    + Register Another
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {formError && (
        <div className="flex items-start gap-2.5 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-800">{formError}</p>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-5"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClasses}>Delegate Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              placeholder="Full name"
              maxLength={200}
              className={inputClasses}
            />
          </div>

          <div>
            <label className={labelClasses}>Medical Council Number</label>
            <input
              value={medicalCouncilNumber}
              onChange={(e) => setMedicalCouncilNumber(e.target.value)}
              disabled={submitting}
              placeholder="e.g. TNMC-12345 or State Reg No."
              maxLength={100}
              className={inputClasses}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClasses}>Category</label>
            <select
              value={category}
              onChange={(e) => handleCategoryChange(e.target.value)}
              disabled={submitting}
              className={inputClasses}
            >
              <option value="">No Category (Auto PMCON number)…</option>
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
              disabled={submitting}
              className={inputClasses}
            >
              <option value="">Select preference (Default: Not Specified)…</option>
              {FOOD_OPTIONS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClasses}>Payment Status *</label>
            <select
              value={paymentStatus}
              onChange={(e) => setPaymentStatus(e.target.value)}
              disabled={submitting}
              className={inputClasses}
            >
              <option value="">Select…</option>
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
              disabled={submitting}
              className={inputClasses}
            >
              <option value="">Not specified</option>
              {GENDER_OPTIONS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClasses}>Phone Number</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
              maxLength={10}
              disabled={submitting}
              placeholder="Enter 10-digit number"
              className={inputClasses}
            />
          </div>

          <div>
            <label className={labelClasses}>Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              placeholder="optional"
              className={inputClasses}
            />
          </div>
        </div>

        {category === 'Exhibitors' && exhibitorConfigured === false && (
          <div className="flex items-start gap-2.5 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800">
              Exhibitor registration is not yet configured. An administrator
              must set the starting registration number in Registration Number
              Settings before exhibitors can be registered.
            </p>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-teal-600 to-blue-600 hover:from-teal-700 hover:to-blue-700 text-white font-semibold text-sm py-2.5 transition-all shadow-lg shadow-teal-600/20 hover:shadow-teal-600/30 disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98]"
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Registering…
            </>
          ) : (
            <>
              <UserPlus className="w-4 h-4" />
              Register Attendee
            </>
          )}
        </button>
      </form>
    </div>
  );
}
