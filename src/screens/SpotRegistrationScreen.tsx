import { useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import {
  CATEGORIES,
  GENDER_OPTIONS,
  PAYMENT_STATUSES,
  type SpotRegistrationResult,
} from '@/lib/supabase';
import {
  UserPlus,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Lock,
} from 'lucide-react';

const FOOD_OPTIONS = ['Vegetarian', 'Non-Vegetarian', 'Not Specified'] as const;

export default function SpotRegistrationScreen() {
  const { authState } = useAuth();
  const role =
    authState.status === 'authenticated' ? authState.profile.role : 'scanner';

  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>('');
  const [foodPreference, setFoodPreference] = useState<string>('');
  const [paymentStatus, setPaymentStatus] = useState<string>('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [gender, setGender] = useState('');
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState<SpotRegistrationResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
      .maybeSingle();
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
    if (!category) {
      setFormError('Please select a category.');
      return;
    }
    if (!foodPreference) {
      setFormError('Please select a food preference.');
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
    if (
      trimmedPhone &&
      !/^(\+91)?[0-9]{10}$/.test(trimmedPhone.replace(/\s/g, ''))
    ) {
      setFormError(
        'Phone number must be 10 digits, optionally prefixed with +91.',
      );
      return;
    }

    // Exhibitor config guard
    if (category === 'Exhibitors' && exhibitorConfigured === false) {
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
        p_category: category,
        p_food_preference: foodPreference,
        p_payment_status: paymentStatus,
        p_phone_number: trimmedPhone || null,
        p_email: trimmedEmail ? trimmedEmail.toLowerCase() : null,
        p_gender: gender || null,
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

      const result = data as unknown as { registration_number: string; qr_token: string; attendee_id: string };
      setSuccess(result);
      resetForm();
      // Audit: log attendee creation (no QR token or PII in details)
      await supabase.rpc('log_audit', {
        p_action: 'attendee_created',
        p_target_type: 'attendee',
        p_target_id: result.attendee_id,
        p_details: {
          registration_number: result.registration_number,
          name: trimmedName,
          category,
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
          Register a new attendee on-site. The registration number is generated
          automatically based on the selected category.
        </p>
      </div>

      {success && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-emerald-900 mb-1">
                Registration Successful
              </h3>
              <div className="space-y-1 text-sm text-emerald-800">
                <p>
                  <span className="font-medium">Registration Number:</span>{' '}
                  <span className="font-mono font-bold">
                    {success.registration_number}
                  </span>
                </p>
                <p>
                  <span className="font-medium">QR Token:</span>{' '}
                  <span className="font-mono text-xs">
                    {success.qr_token.slice(0, 8)}…
                  </span>
                </p>
              </div>
              <button
                onClick={() => setSuccess(null)}
                className="mt-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-4 py-2 transition"
              >
                Register Another
              </button>
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClasses}>Category *</label>
            <select
              value={category}
              onChange={(e) => handleCategoryChange(e.target.value)}
              disabled={submitting}
              className={inputClasses}
            >
              <option value="">Select category…</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClasses}>Food Preference *</label>
            <select
              value={foodPreference}
              onChange={(e) => setFoodPreference(e.target.value)}
              disabled={submitting}
              className={inputClasses}
            >
              <option value="">Select…</option>
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
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={submitting}
              placeholder="+919876543210 or 9876543210"
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
