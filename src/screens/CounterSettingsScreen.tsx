import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { CounterStatus } from '@/lib/supabase';
import {
  Settings2,
  Loader2,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import Modal from '@/components/Modal';

export default function CounterSettingsScreen() {
  const [counters, setCounters] = useState<CounterStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [configTarget, setConfigTarget] = useState<CounterStatus | null>(null);
  const [newNextValue, setNewNextValue] = useState('');
  const [newStartValue, setNewStartValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [configError, setConfigError] = useState('');

  const fetchCounters = async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error: rpcError } = await supabase.rpc('get_counter_status');
      if (rpcError) throw rpcError;
      setCounters((data ?? []) as CounterStatus[]);
    } catch {
      setError('Unable to load counter status. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCounters();
  }, []);

  const openConfig = (c: CounterStatus) => {
    setConfigTarget(c);
    setNewNextValue(c.next_value?.toString() ?? '');
    setNewStartValue(c.start_value?.toString() ?? '');
    setConfigError('');
  };

  const handleConfigure = async () => {
    if (!configTarget) return;
    setConfigError('');
    setSaving(true);

    const nextVal = parseInt(newNextValue, 10);
    if (isNaN(nextVal) || nextVal < 1) {
      setConfigError('Next number must be a positive whole number.');
      setSaving(false);
      return;
    }

    const startVal = newStartValue
      ? parseInt(newStartValue, 10)
      : null;
    if (startVal !== null && (isNaN(startVal) || startVal < 1)) {
      setConfigError('Starting number must be a positive whole number.');
      setSaving(false);
      return;
    }

    try {
      const { error: rpcError } = await supabase.rpc('configure_counter', {
        p_counter_key: configTarget.counter_key,
        p_new_next_value: nextVal,
        p_new_start_value: startVal,
      });
      if (rpcError) {
        const msg = rpcError.message;
        if (msg.includes('already exists')) {
          setConfigError(msg);
        } else if (msg.includes('Permission denied')) {
          setConfigError('You do not have permission to configure counters.');
        } else {
          setConfigError(
            'Unable to update the counter. Please check the value and try again.',
          );
        }
        return;
      }
      setConfigTarget(null);
      setSuccess('Counter updated successfully.');
      fetchCounters();
      setTimeout(() => setSuccess(''), 3000);
      // Audit: log counter configuration change
      await supabase.rpc('log_audit', {
        p_action: 'counter_changed',
        p_target_type: 'counter',
        p_details: {
          counter_key: configTarget.counter_key,
          new_next_value: nextVal,
          new_start_value: startVal,
        },
      });
    } catch {
      setConfigError('A network error occurred. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-500 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading counter status…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-slate-900 mb-1">
          Registration Number Settings
        </h2>
        <p className="text-sm text-slate-500">
          Configure the starting and next registration number for each category
          sequence. The system never assigns a number that already exists.
        </p>
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {counters.map((c) => (
          <div
            key={c.counter_key}
            className="bg-white rounded-xl border border-slate-200 shadow-sm p-5"
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  {c.display_name}
                </h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">
                  {c.counter_key}
                </p>
              </div>
              {c.configured ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Configured
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                  <AlertTriangle className="w-3 h-3" />
                  Not Configured
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg bg-slate-50 px-3 py-2.5">
                <p className="text-xs text-slate-500 mb-0.5">Starting Number</p>
                <p className="font-semibold text-slate-900 tabular-nums">
                  {c.start_value !== null
                    ? `${c.prefix}-${String(c.start_value).padStart(4, '0')}`
                    : '—'}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 px-3 py-2.5">
                <p className="text-xs text-slate-500 mb-0.5">Next Number</p>
                <p className="font-semibold text-slate-900 tabular-nums">
                  {c.next_value !== null
                    ? `${c.prefix}-${String(c.next_value).padStart(4, '0')}`
                    : '—'}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 px-3 py-2.5">
                <p className="text-xs text-slate-500 mb-0.5">Last Used</p>
                <p className="font-semibold text-slate-900 tabular-nums">
                  {c.last_used_value !== null
                    ? `${c.prefix}-${String(c.last_used_value).padStart(4, '0')}`
                    : '—'}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 px-3 py-2.5">
                <p className="text-xs text-slate-500 mb-0.5">Highest in DB</p>
                <p className="font-semibold text-slate-900 tabular-nums">
                  {c.highest_used_in_db > 0
                    ? `${c.prefix}-${String(c.highest_used_in_db).padStart(4, '0')}`
                    : '—'}
                </p>
              </div>
            </div>

            <button
              onClick={() => openConfig(c)}
              className="mt-4 w-full flex items-center justify-center gap-2 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 transition"
            >
              <Settings2 className="w-4 h-4" />
              {c.configured ? 'Update Counter' : 'Configure Counter'}
            </button>
          </div>
        ))}
      </div>

      {/* Configure modal */}
      <Modal
        open={!!configTarget}
        onClose={() => setConfigTarget(null)}
        title={
          configTarget
            ? `Configure — ${configTarget.display_name}`
            : 'Configure Counter'
        }
        maxWidth="max-w-md"
      >
        {configTarget && (
          <div className="space-y-4">
            <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
              <p className="font-medium mb-1">Current state</p>
              <p className="text-xs">
                Highest number in use:{' '}
                <span className="font-mono font-semibold">
                  {configTarget.highest_used_in_db > 0
                    ? `${configTarget.prefix}-${String(configTarget.highest_used_in_db).padStart(4, '0')}`
                    : 'none'}
                </span>
              </p>
              <p className="text-xs mt-0.5">
                The next number must be greater than{' '}
                <span className="font-mono font-semibold">
                  {configTarget.highest_used_in_db}
                </span>
                .
              </p>
            </div>

            {configError && (
              <div className="flex items-start gap-2.5 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-800">{configError}</p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Next Registration Number (numeric part)
              </label>
              <input
                type="number"
                min={1}
                value={newNextValue}
                onChange={(e) => setNewNextValue(e.target.value)}
                placeholder="e.g. 150"
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
              />
              <p className="text-xs text-slate-500 mt-1">
                Will produce{' '}
                <span className="font-mono">
                  {newNextValue && !isNaN(parseInt(newNextValue, 10))
                    ? `${configTarget.prefix}-${String(parseInt(newNextValue, 10)).padStart(4, '0')}`
                    : '—'}
                </span>
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Starting Number (optional)
              </label>
              <input
                type="number"
                min={1}
                value={newStartValue}
                onChange={(e) => setNewStartValue(e.target.value)}
                placeholder="e.g. 150"
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
              />
            </div>

            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800">
              <p className="font-medium mb-0.5">Confirm before saving</p>
              <p>
                Changing a counter is logged in the audit trail. The system will
                reject any value that would collide with an existing registration
                number.
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-1">
              <button
                onClick={() => setConfigTarget(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleConfigure}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-teal-600 to-blue-600 hover:from-teal-700 hover:to-blue-700 text-white text-sm font-semibold px-4 py-2 transition disabled:opacity-60"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Save Changes
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
