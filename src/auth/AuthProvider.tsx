import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { authConfigError } from '@/config/env';

import { devTokenFromEnv, isDevTokenAllowed } from './dev-token';
import { authEvents } from './events';
import { session } from './instance';
import type { SessionState } from './session';
import { signInInteractive, signOutEverywhere, type SignInResult } from './sign-in';

interface AuthContextValue {
  state: SessionState;
  /** Why sign-in can't start in this build (missing client ID), if so. */
  configError?: string;
  /** The API denied the user because their email isn't verified. */
  emailNotVerified: boolean;
  /** Last auth-level message to show on the welcome screen (expired session…). */
  notice?: string;
  signIn: (opts?: { selectAccount?: boolean }) => Promise<SignInResult>;
  signOut: () => Promise<void>;
  /** Re-mint the access token and clear the verification flag; the caller re-checks. */
  recheckEmail: () => Promise<void>;
  clearEmailNotVerified: () => void;
  /** __DEV__ staging only. */
  signInWithDevToken?: (token: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(session.getState());
  const [emailNotVerified, setEmailNotVerified] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  const configError = authConfigError();

  useEffect(() => {
    const unsubscribe = session.subscribe((next) => {
      setState(next);
      if (next.status === 'signedOut') {
        setEmailNotVerified(false);
        if (next.reason === 'expired') setNotice('Your session has ended. Sign in again.');
      }
      if (next.status === 'signedIn') setNotice(undefined);
    });
    void (async () => {
      const restored = await session.restore();
      // __DEV__ first so Metro folds the whole branch away in release builds.
      if (__DEV__ && restored.status === 'signedOut') {
        const token = devTokenFromEnv();
        if (token) {
          try {
            session.useStaticAccessToken(token);
          } catch (error) {
            setNotice(`Dev token rejected: ${(error as Error).message}`);
          }
        }
      }
    })();
    return unsubscribe;
  }, []);

  useEffect(
    () =>
      authEvents.subscribe((event) => {
        if (event.type === 'emailNotVerified') setEmailNotVerified(true);
        if (event.type === 'authRequired' && event.message) setNotice(event.message);
      }),
    []
  );

  const signIn = useCallback(
    async (opts?: { selectAccount?: boolean }): Promise<SignInResult> => {
      if (configError) return { type: 'error', message: configError };
      setNotice(undefined);
      try {
        return await signInInteractive(opts);
      } catch (error) {
        return { type: 'error', message: (error as Error).message };
      }
    },
    [configError]
  );

  const signOut = useCallback(async () => {
    await signOutEverywhere();
  }, []);

  const recheckEmail = useCallback(async () => {
    if (state.status === 'signedIn' && !state.devToken) {
      // A fresh token is a fresh TokenReview cache key on the API server, so
      // the next call re-introspects instead of replaying "unverified".
      await session.refresh();
    }
    setEmailNotVerified(false);
  }, [state]);

  const signInWithDevToken = useMemo(() => {
    if (!__DEV__ || !isDevTokenAllowed()) return undefined;
    return (token: string) => {
      session.useStaticAccessToken(token.trim());
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      configError,
      emailNotVerified,
      notice,
      signIn,
      signOut,
      recheckEmail,
      clearEmailNotVerified: () => setEmailNotVerified(false),
      signInWithDevToken,
    }),
    [state, configError, emailNotVerified, notice, signIn, signOut, recheckEmail, signInWithDevToken]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

/** The signed-in user's sub; throws if called outside a signed-in tree. */
export function useUserSub(): string {
  const { state } = useAuth();
  if (state.status !== 'signedIn') throw new Error('Not signed in');
  return state.user.sub;
}
