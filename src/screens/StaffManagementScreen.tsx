import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import type { StaffMember, StaffRole } from '@/lib/supabase';
import Modal from '@/components/Modal';
import {
  ShieldCheck,
  UserPlus,
  Loader2,
  Pencil,
  Mail,
  Power,
  AlertCircle,
  CheckCircle2,
  Lock,
  KeyRound,
  Trash2,
} from 'lucide-react';

const ROLES: { value: StaffRole; label: string }[] = [
  { value: 'admin', label: 'Administrator' },
  { value: 'registration', label: 'Registration' },
  { value: 'scanner', label: 'Scanner' },
];

const ROLE_BADGE: Record<StaffRole, string> = {
  admin: 'bg-teal-100 text-teal-800',
  registration: 'bg-blue-100 text-blue-800',
  scanner: 'bg-slate-100 text-slate-700',
  staff: 'bg-emerald-100 text-emerald-800',
};

const FUNCTION_URL = (import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_URL !== 'undefined')
  ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/staff-admin`
  : '/functions/v1/staff-admin';

export default function StaffManagementScreen() {
  const { authState } = useAuth();
  const profile =
    authState.status === 'authenticated' ? authState.profile : null;
  const session =
    authState.status === 'authenticated' ? authState.session : null;

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<StaffMember | null>(null);
  const [resetTarget, setResetTarget] = useState<StaffMember | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StaffMember | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    const { data, error: e } = await supabase.rpc('list_staff_with_emails');
    if (e) {
      setError('Unable to load staff list.');
      setStaff([]);
    } else {
      setStaff((data as StaffMember[]) || []);
      setError('');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchStaff();
  }, [fetchStaff]);

  const callEdgeFunction = async (
    path: string,
    method: 'POST' | 'PUT' | 'DELETE',
    body?: Record<string, unknown>,
  ) => {
    if (!session) throw new Error('No active session');
    const res = await fetch(`${FUNCTION_URL}/${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json?.error ?? `Request failed (${res.status})`);
    }
    return json;
  };

  const handleCreate = async (data: {
    name: string;
    email: string;
    role: StaffRole;
    password?: string;
  }) => {
    setSaving(true);
    setError('');
    try {
      await callEdgeFunction('create', 'POST', data);
      setCreateOpen(false);
      setSuccess('Staff member created successfully.');
      fetchStaff();
      setTimeout(() => setSuccess(''), 4000);
    } catch (e) {
      setError((e as Error).message ?? 'Failed to create staff member.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteStaff = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    setError('');
    try {
      await callEdgeFunction(`delete/${deleteTarget.id}`, 'DELETE');
      setDeleteTarget(null);
      setSuccess('Staff member deleted successfully.');
      fetchStaff();
      setTimeout(() => setSuccess(''), 4000);
    } catch (e) {
      setError((e as Error).message ?? 'Failed to delete staff member.');
    } finally {
      setSaving(false);
    }
  };

  const handleEditSave = async (data: { name?: string; role?: StaffRole }) => {
    if (!editTarget) return;
    setSaving(true);
    setError('');
    try {
      await callEdgeFunction(`update/${editTarget.id}`, 'PUT', data);
      setEditTarget(null);
      setSuccess('Staff member updated.');
      fetchStaff();
      setTimeout(() => setSuccess(''), 4000);
    } catch (e) {
      setError((e as Error).message ?? 'Failed to update staff member.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (s: StaffMember) => {
    setSaving(true);
    setError('');
    try {
      await callEdgeFunction(`update/${s.id}`, 'PUT', { active: !s.active });
      setSuccess(s.active ? 'Staff member deactivated.' : 'Staff member activated.');
      fetchStaff();
      setTimeout(() => setSuccess(''), 4000);
    } catch (e) {
      setError((e as Error).message ?? 'Failed to change active status.');
    } finally {
      setSaving(false);
    }
  };

  const handleResetConfirm = async () => {
    if (!resetTarget) return;
    setResetting(true);
    setError('');
    try {
      await callEdgeFunction(`reset/${resetTarget.id}`, 'POST', {});
      setResetTarget(null);
      setSuccess('Password-reset email sent.');
      setTimeout(() => setSuccess(''), 4000);
    } catch (e) {
      setError((e as Error).message ?? 'Failed to send reset email.');
    } finally {
      setResetting(false);
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
      {success && (
        <div className="flex items-start gap-2.5 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-emerald-800">{success}</p>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-teal-600" />
          <div>
            <h2 className="text-base font-semibold text-slate-900">Staff Management</h2>
            <p className="text-sm text-slate-500">
              Create, edit, activate and manage staff access. Deactivation is used instead of deletion to preserve history.
            </p>
          </div>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-teal-600 to-blue-600 hover:from-teal-700 hover:to-blue-700 text-white text-sm font-semibold px-4 py-2 transition shadow-sm active:scale-[0.98]"
        >
          <UserPlus className="w-4 h-4" />
          Invite Staff
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left">
                <th className="px-4 py-3 font-semibold text-slate-700">Name</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Email</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Role</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Status</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Created</th>
                <th className="px-4 py-3 font-semibold text-slate-700 text-right">Actions</th>
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
              ) : staff.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                    No staff members found.
                  </td>
                </tr>
              ) : (
                staff.map((s) => {
                  const isSelf = s.id === profile?.id;
                  return (
                    <tr key={s.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">
                        {s.name}
                        {isSelf && (
                          <span className="ml-2 text-xs text-slate-400">(you)</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{s.email ?? '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_BADGE[s.role]}`}>
                          {ROLES.find((r) => r.value === s.role)?.label ?? s.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${s.active ? 'text-emerald-700' : 'text-slate-500'}`}>
                          <span className={`w-2 h-2 rounded-full ${s.active ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                          {s.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs">
                        {new Date(s.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setEditTarget(s)}
                            title="Edit name / role"
                            className="p-1.5 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-blue-50 transition"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setResetTarget(s)}
                            title="Send password-reset email"
                            className="p-1.5 rounded-lg text-slate-500 hover:text-amber-700 hover:bg-amber-50 transition"
                          >
                            <KeyRound className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleToggleActive(s)}
                            title={s.active ? 'Deactivate' : 'Activate'}
                            disabled={isSelf && s.active}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-amber-700 hover:bg-amber-50 transition disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <Power className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(s)}
                            title="Delete staff member"
                            disabled={isSelf}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-red-700 hover:bg-red-50 transition disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
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

      {/* Create modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Add Staff Member" maxWidth="max-w-md">
        <CreateStaffForm onSave={handleCreate} onCancel={() => setCreateOpen(false)} saving={saving} />
      </Modal>

      {/* Edit modal */}
      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title="Edit Staff Member" maxWidth="max-w-md">
        {editTarget && (
          <EditStaffForm
            staff={editTarget}
            onSave={handleEditSave}
            onCancel={() => setEditTarget(null)}
            saving={saving}
            isSelf={editTarget.id === profile?.id}
          />
        )}
      </Modal>

      {/* Delete confirmation */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Staff Member" maxWidth="max-w-md">
        {deleteTarget && (
          <div className="space-y-4">
            <div className="flex items-start gap-2.5 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">
                Are you sure you want to delete staff account for <strong>{deleteTarget.name}</strong> ({deleteTarget.email})? This action cannot be undone.
              </p>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setDeleteTarget(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition">
                Cancel
              </button>
              <button
                onClick={handleDeleteStaff}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-4 py-2 transition disabled:opacity-60"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Delete Staff
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Reset confirmation */}
      <Modal open={!!resetTarget} onClose={() => setResetTarget(null)} title="Send Password-Reset Email" maxWidth="max-w-md">
        {resetTarget && (
          <div>
            <div className="flex items-start gap-2.5 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 mb-4">
              <Mail className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-blue-800">
                A password-reset link will be emailed to <strong>{resetTarget.email}</strong>. The link expires after one hour.
              </p>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setResetTarget(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition">
                Cancel
              </button>
              <button
                onClick={handleResetConfirm}
                disabled={resetting}
                className="flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 transition disabled:opacity-60"
              >
                {resetting && <Loader2 className="w-4 h-4 animate-spin" />}
                Send Reset Email
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function CreateStaffForm({
  onSave,
  onCancel,
  saving,
}: {
  onSave: (data: { name: string; email: string; role: StaffRole; password?: string }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<StaffRole>('registration');
  const [formError, setFormError] = useState('');

  const inputClasses =
    'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition';
  const labelClasses = 'block text-sm font-medium text-slate-700 mb-1.5';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPassword = password.trim();
    if (!trimmedName) { setFormError('Name is required.'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedEmail)) { setFormError('A valid email is required.'); return; }
    if (!trimmedPassword || trimmedPassword.length < 6) { setFormError('Password must be at least 6 characters.'); return; }
    onSave({ name: trimmedName, email: trimmedEmail, role, password: trimmedPassword });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {formError && (
        <div className="flex items-start gap-2.5 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-800">{formError}</p>
        </div>
      )}
      <div>
        <label className={labelClasses}>Full Name *</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputClasses} maxLength={200} placeholder="e.g. Arun Kumar" required />
      </div>
      <div>
        <label className={labelClasses}>Email ID *</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClasses} placeholder="staff@gmail.com" required />
      </div>
      <div>
        <label className={labelClasses}>Password *</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClasses}
          placeholder="Enter staff login password (min 6 characters)"
          minLength={6}
          required
        />
        <p className="text-xs text-slate-500 mt-1">Staff member can immediately sign in with this email and password.</p>
      </div>
      <div>
        <label className={labelClasses}>Role *</label>
        <select value={role} onChange={(e) => setRole(e.target.value as StaffRole)} className={inputClasses}>
          {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition">Cancel</button>
        <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-teal-600 to-blue-600 hover:from-teal-700 hover:to-blue-700 text-white text-sm font-semibold px-4 py-2 transition disabled:opacity-60">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Add Staff Member
        </button>
      </div>
    </form>
  );
}

function EditStaffForm({
  staff,
  onSave,
  onCancel,
  saving,
  isSelf,
}: {
  staff: StaffMember;
  onSave: (data: { name?: string; role?: StaffRole }) => void;
  onCancel: () => void;
  saving: boolean;
  isSelf: boolean;
}) {
  const [name, setName] = useState(staff.name);
  const [role, setRole] = useState<StaffRole>(staff.role);
  const [formError, setFormError] = useState('');

  const inputClasses =
    'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition';
  const labelClasses = 'block text-sm font-medium text-slate-700 mb-1.5';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const trimmedName = name.trim();
    if (!trimmedName) { setFormError('Name is required.'); return; }
    const patch: { name?: string; role?: StaffRole } = {};
    if (trimmedName !== staff.name) patch.name = trimmedName;
    if (role !== staff.role) {
      if (isSelf && role !== 'admin') {
        setFormError('You cannot demote yourself.');
        return;
      }
      patch.role = role;
    }
    if (Object.keys(patch).length === 0) {
      onCancel();
      return;
    }
    onSave(patch);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {formError && (
        <div className="flex items-start gap-2.5 rounded-lg bg-red-50 border border-slate-200 px-4 py-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-800">{formError}</p>
        </div>
      )}
      <div>
        <label className={labelClasses}>Full Name *</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputClasses} maxLength={200} />
      </div>
      <div>
        <label className={labelClasses}>Role</label>
        <select value={role} onChange={(e) => setRole(e.target.value as StaffRole)} className={inputClasses}>
          {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        {isSelf && (
          <p className="text-xs text-slate-400 mt-1">Self-demotion is blocked for safety.</p>
        )}
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition">Cancel</button>
        <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-teal-600 to-blue-600 hover:from-teal-700 hover:to-blue-700 text-white text-sm font-semibold px-4 py-2 transition disabled:opacity-60">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Save Changes
        </button>
      </div>
    </form>
  );
}
