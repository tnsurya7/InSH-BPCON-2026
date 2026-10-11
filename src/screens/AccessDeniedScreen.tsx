import { useAuth } from '@/lib/auth';
import { ShieldCheck, UserCircle, LogOut, AlertTriangle } from 'lucide-react';

/**
 * Dedicated screen for a user who has valid auth credentials but either:
 *  - has no staff_profiles row, or
 *  - has active = false.
 * Keeps them out of the app while surfacing a clear, specific message.
 * They can sign out from here.
 */
export default function AccessDeniedScreen() {
  const { authState, signOut } = useAuth();

  const title =
    authState.status === 'inactive' ? 'Account Inactive' : 'No Staff Profile';

  const message =
    authState.status === 'inactive'
      ? 'Your account has been deactivated. Please contact an administrator to reactivate it.'
      : authState.status === 'no_profile'
        ? 'No staff profile is linked to your account. Please contact an administrator to have one created.'
        : 'Access denied. Please contact an administrator.';

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-4 py-10">
      <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-amber-400 via-orange-500 to-red-500" />

      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 mb-4">
            <AlertTriangle className="w-8 h-8 text-amber-400" />
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight">
            {title}
          </h1>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8 text-center">
          <p className="text-sm text-slate-600 leading-relaxed mb-6">
            {message}
          </p>

          <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 mb-6 flex items-center justify-center gap-2">
            <UserCircle className="w-5 h-5 text-slate-400" />
            <span className="text-xs text-slate-500">
              Signed in but not authorised
            </span>
          </div>

          <button
            onClick={() => signOut()}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-slate-800 hover:bg-slate-900 text-white font-semibold text-sm py-2.5 transition active:scale-[0.98]"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>

        <div className="text-center mt-6">
          <div className="inline-flex items-center gap-1.5 text-slate-500 text-xs">
            <ShieldCheck className="w-3.5 h-3.5" />
            MS Registrations
          </div>
        </div>
      </div>
    </div>
  );
}
