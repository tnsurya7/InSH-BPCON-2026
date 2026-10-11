import { AuthProvider, useAuth } from '@/lib/auth';
import LoginScreen from '@/screens/LoginScreen';
import AccessDeniedScreen from '@/screens/AccessDeniedScreen';
import DashboardScreen from '@/screens/DashboardScreen';
import { ShieldCheck, Loader2 } from 'lucide-react';

function AppShell() {
  const { authState, signOut } = useAuth();

  if (authState.status === 'loading') {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center">
        <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-teal-400 via-cyan-500 to-blue-600" />
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-teal-500 to-blue-600 shadow-lg shadow-teal-500/20 mb-4">
          <ShieldCheck className="w-8 h-8 text-white" />
        </div>
        <div className="flex items-center gap-2 text-slate-300 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading…
        </div>
      </div>
    );
  }

  if (authState.status === 'unauthenticated') {
    return <LoginScreen />;
  }

  if (
    authState.status === 'no_profile' ||
    authState.status === 'inactive'
  ) {
    return <AccessDeniedScreen />;
  }

  if (authState.status === 'error') {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md text-center">
          <h1 className="text-lg font-bold text-slate-900 mb-2">
            Something went wrong
          </h1>
          <p className="text-sm text-slate-600 mb-6">{authState.error}</p>
          <div className="flex flex-col sm:flex-row justify-center gap-3">
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg bg-slate-800 text-white text-sm font-semibold px-5 py-2.5 hover:bg-slate-900 transition"
            >
              Retry
            </button>
            <button
              onClick={() => signOut()}
              className="rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold px-5 py-2.5 hover:bg-slate-50 transition"
            >
              Sign In Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  // authenticated
  return <DashboardScreen />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
