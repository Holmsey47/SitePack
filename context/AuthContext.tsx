import {
  ensureWebAuthUrlStripped,
  INVALID_AUTH_LINK,
  settleAuthLink,
  takeWebAuthUrl,
  accountIdentityFromUser,
  type ConfirmAccounts,
} from '@/lib/authLink';
import { repo, useFixtures } from '@/data/index';
import { getSupabase, hasSupabaseConfig } from '@/lib/supabase';
import type { JoinWithCodeInput, Person } from '@/data/types';
import { AuthLinkConfirm } from '@/components/auth-link-confirm';
import * as Linking from 'expo-linking';
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

type AuthState = {
  ready: boolean;
  person: Person | null;
  needsPassword: boolean;
  linkError: string | null;
  usingFixtures: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithUsername: (username: string, password: string) => Promise<void>;
  joinWithCode: (input: JoinWithCodeInput) => Promise<string>;
  redeemPasswordReset: (code: string, password: string) => Promise<void>;
  acknowledgePasswordReset: () => Promise<void>;
  signOut: () => Promise<void>;
  setPassword: (password: string) => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

const PENDING_KEY = 'sitepack.pendingPassword';

function readPending(): boolean {
  try {
    return globalThis.localStorage?.getItem(PENDING_KEY) === '1';
  } catch {
    return false;
  }
}

function writePending(value: boolean) {
  try {
    if (value) globalThis.localStorage?.setItem(PENDING_KEY, '1');
    else globalThis.localStorage?.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  ensureWebAuthUrlStripped();
  const [ready, setReady] = useState(false);
  const [person, setPerson] = useState<Person | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [confirmAccounts, setConfirmAccounts] = useState<ConfirmAccounts | null>(null);
  const confirmResolve = useRef<((accepted: boolean) => void) | null>(null);

  useLayoutEffect(() => {
    ensureWebAuthUrlStripped();
  });

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const captured = takeWebAuthUrl();
      let linkUrl = captured;
      if (!linkUrl && typeof window === 'undefined') {
        linkUrl = await Linking.getInitialURL();
      }
      try {
        if (linkUrl && !useFixtures && hasSupabaseConfig) {
          const supabase = getSupabase();
          const outcome = await settleAuthLink({
            url: linkUrl,
            now: Math.floor(Date.now() / 1000),
            getExisting: async () => {
              try {
                const { data, error } = await supabase.auth.getSession();
                if (error) return { state: 'unknown' };
                const identity = accountIdentityFromUser(data.session?.user);
                if (!identity) return { state: 'none' };
                return { state: 'signed-in', identity };
              } catch {
                return { state: 'unknown' };
              }
            },
            verifyToken: async (accessToken) => {
              try {
                const { data, error } = await supabase.auth.getUser(accessToken);
                if (error || !data.user) return null;
                return accountIdentityFromUser(data.user);
              } catch {
                return null;
              }
            },
            setSession: async (tokens) => {
              const { data, error } = await supabase.auth.setSession({
                access_token: tokens.accessToken,
                refresh_token: tokens.refreshToken,
              });
              return {
                error: error ? error.message : null,
                accessToken: error ? null : data.session?.access_token ?? null,
              };
            },
            signOut: async () => {
              await supabase.auth.signOut();
            },
            confirm: (accounts) =>
              new Promise((resolve) => {
                if (cancelled) {
                  resolve(false);
                  return;
                }
                confirmResolve.current = resolve;
                setConfirmAccounts(accounts);
              }),
          });
          if (!cancelled) {
            if (outcome.status === 'applied') {
              writePending(true);
              setLinkError(null);
            } else if (outcome.status === 'rejected') {
              if (outcome.signedOut) writePending(false);
              setLinkError(outcome.message);
            }
          }
        }
        if (!useFixtures && hasSupabaseConfig) {
          const supabase = getSupabase();
          supabase.auth.onAuthStateChange(async (_event, session) => {
            if (!session) {
              setPerson(null);
              return;
            }
            try {
              const me = await repo.me();
              if (!cancelled) setPerson(me);
            } catch {
              if (!cancelled) setPerson(null);
            }
          });
        }
        const me = await repo.restoreSession();
        if (!cancelled) {
          setPerson(me);
          setNeedsPassword(Boolean(me) && readPending());
        }
      } catch {
        if (!cancelled) setLinkError(INVALID_AUTH_LINK);
      } finally {
        if (!cancelled) {
          setConfirmAccounts(null);
          setReady(true);
        }
      }
    }

    void boot();
    return () => {
      cancelled = true;
      confirmResolve.current?.(false);
      confirmResolve.current = null;
    };
  }, []);

  function chooseConfirm(accepted: boolean) {
    const resolve = confirmResolve.current;
    confirmResolve.current = null;
    resolve?.(accepted);
  }

  const value = useMemo<AuthState>(
    () => ({
      ready,
      person,
      needsPassword,
      linkError,
      usingFixtures: useFixtures,
      signIn: async (email, password) => {
        setLinkError(null);
        const result = await repo.signIn(email, password);
        setPerson(result.person);
        setNeedsPassword(result.needsPassword || readPending());
      },
      signInWithUsername: async (username, password) => {
        setLinkError(null);
        const result = await repo.signInWithUsername(username, password);
        setPerson(result.person);
        setNeedsPassword(false);
      },
      joinWithCode: async (input) => {
        setLinkError(null);
        const result = await repo.joinWithCode(input);
        setPerson(result.person);
        setNeedsPassword(false);
        return result.siteId;
      },
      redeemPasswordReset: async (code, password) => {
        await repo.redeemPasswordReset(code, password);
      },
      acknowledgePasswordReset: async () => {
        await repo.acknowledgePasswordReset();
        const me = await repo.me();
        setPerson(me);
      },
      signOut: async () => {
        await repo.signOut();
        writePending(false);
        setLinkError(null);
        setNeedsPassword(false);
        setPerson(null);
      },
      setPassword: async (password) => {
        await repo.setPassword(password);
        writePending(false);
        setNeedsPassword(false);
        const me = await repo.me();
        setPerson(me);
      },
      refresh: async () => {
        const me = await repo.me();
        setPerson(me);
      },
    }),
    [ready, person, needsPassword, linkError]
  );

  return (
    <AuthContext.Provider value={value}>
      {confirmAccounts ? (
        <AuthLinkConfirm
          currentAccount={confirmAccounts.currentAccount}
          linkAccount={confirmAccounts.linkAccount}
          onStay={() => chooseConfirm(false)}
          onUseLink={() => chooseConfirm(true)}
        />
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
