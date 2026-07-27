import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { StaffProfile, StaffRole } from './supabase';

export type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | {
      status: 'authenticated';
      session: Session;
      profile: StaffProfile;
    }
  | {
      status: 'no_profile';
      session: Session;
      error: string;
    }
  | {
      status: 'inactive';
      session: Session;
      profile: StaffProfile;
      error: string;
    }
  | {
      status: 'error';
      session: Session;
      error: string;
    };

type AuthContextValue = {
  authState: AuthState;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>({
    status: 'loading',
  });

  const loadProfile = useCallback(
    async (session: Session): Promise<AuthState> => {
      const userId = session.user.id;
      const { data: profile, error } = await supabase
        .from('staff_profiles')
        .select('id, name, role, active, created_at, updated_at')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        return {
          status: 'error',
          session,
          error: 'Unable to verify staff account. Please try again.',
        };
      }

      if (!profile) {
        return {
          status: 'no_profile',
          session,
          error:
            'No staff profile is linked to your account. Please contact an administrator.',
        };
      }

      const typedProfile: StaffProfile = {
        id: profile.id,
        name: profile.name,
        role: profile.role as StaffRole,
        active: profile.active,
        created_at: profile.created_at,
        updated_at: profile.updated_at,
      };

      if (!typedProfile.active) {
        return {
          status: 'inactive',
          session,
          profile: typedProfile,
          error:
            'Your account is inactive. Please contact an administrator to reactivate it.',
        };
      }

      return {
        status: 'authenticated',
        session,
        profile: typedProfile,
      };
    },
    [],
  );

  useEffect(() => {
    let mounted = true;

    supabase.auth.onAuthStateChange((event, session) => {
      // Wrap async work to avoid deadlock inside the sync callback
      (async () => {
        if (!mounted) return;
        if (event === 'SIGNED_OUT' || !session) {
          setAuthState({ status: 'unauthenticated' });
          return;
        }
        const next = await loadProfile(session);
        setAuthState(next);
      })();
    });

    // Bootstrap: check for an existing session on mount
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      if (!data.session) {
        setAuthState({ status: 'unauthenticated' });
        return;
      }
      const next = await loadProfile(data.session);
      setAuthState(next);
    })();

    return () => {
      mounted = false;
    };
  }, [loadProfile]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error || !data.session) {
        throw new Error('Invalid email or password.');
      }

      const next = await loadProfile(data.session);
      setAuthState(next);

      if (next.status === 'no_profile' || next.status === 'inactive') {
        throw new Error(next.error);
      }
    },
    [loadProfile],
  );

  const refreshProfile = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setAuthState({ status: 'unauthenticated' });
      return;
    }
    const next = await loadProfile(data.session);
    setAuthState(next);
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setAuthState({ status: 'unauthenticated' });
  }, []);

  return (
    <AuthContext.Provider
      value={{ authState, signIn, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
