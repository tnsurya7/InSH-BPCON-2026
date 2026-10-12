import { useState, type FormEvent } from 'react';
import { useAuth } from '@/lib/auth';
import { ShieldCheck, LogIn, AlertCircle, Loader2, Lock, Eye, EyeOff } from 'lucide-react';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign in failed.';
      if (
        msg === 'Invalid email or password.' ||
        msg.includes('Invalid login')
      ) {
        setError('Invalid email or password.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-4 py-10">
      {/* Decorative top accent */}
      <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-teal-400 via-cyan-500 to-blue-600" />

      <div className="w-full max-w-md">
        {/* Brand header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-white/5 border border-white/10 p-2.5 shadow-xl shadow-teal-500/10 mb-4 backdrop-blur-sm">
            <img
              src="/msfav.png"
              alt="MS Registrations Logo"
              className="w-full h-full object-contain rounded-xl"
            />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            MS Registrations
          </h1>
          <p className="text-slate-400 text-sm mt-1.5">
            Conference Registration &amp; Attendance System
          </p>
        </div>

        {/* Login card */}
        <div className="bg-white rounded-2xl shadow-2xl shadow-black/20 p-8">
          <div className="flex items-center gap-2 mb-6">
            <LogIn className="w-5 h-5 text-slate-700" />
            <h2 className="text-lg font-semibold text-slate-900">
              Staff Sign In
            </h2>
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg bg-red-50 border border-red-200 px-4 py-3 mb-5 animate-in fade-in slide-in-from-top-1 duration-200"
            >
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800 leading-snug">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-slate-700 mb-1.5"
              >
                Login ID / Email
              </label>
              <input
                id="email"
                type="text"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                placeholder="Enter email or username"
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition disabled:bg-slate-100 disabled:cursor-not-allowed"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-slate-700 mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-slate-300 pl-3.5 pr-11 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition disabled:bg-slate-100 disabled:cursor-not-allowed"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition p-1 rounded-md"
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-teal-600 to-blue-600 hover:from-teal-700 hover:to-blue-700 text-white font-semibold text-sm py-2.5 transition-all shadow-lg shadow-teal-600/20 hover:shadow-teal-600/30 disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98]"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Signing in…
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  Sign In
                </>
              )}
            </button>
          </form>

          <p className="mt-6 text-xs text-slate-400 text-center leading-relaxed">
            Access is restricted to authorised conference staff.
          </p>
        </div>
      </div>
    </div>
  );
}
