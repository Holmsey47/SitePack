import {
  ensureWebAuthUrlStripped,
  INVALID_AUTH_LINK,
  settleAuthLink,
  settleNativeDeepLink,
  takeWebAuthUrl,
  accountIdentityFromUser,
  type ConfirmAccounts,
  type SettleAuthLinkDeps,
} from '@/lib/authLink';
import { captureIncomingLink } from '@/lib/appLinks';
import { deleteAllDrawingCaches } from '@/lib/offline';
import { repo, useFixtures } from '@/data/index';
import { getSupabase, hasSupabaseConfig } from '@/lib/supabase';
import type { JoinWithCodeInput, Person } from '@/data/types';
import { AuthLinkConfirm } from '@/components/auth-link-confirm';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

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
    const seen = new Set<string>();

    function confirm(accounts: ConfirmAccounts) {
      return new Promise<boolean>((resolve) => {
        if (cancelled) {
          resolve(false);
          return;
        }
        confirmResolve.current = resolve;
        setConfirmAccounts(accounts);
      });
    }

    function linkDeps(url: string): SettleAuthLinkDeps {
      const supabase = getSupabase();
      return {
        url,
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
          try {
            await deleteAllDrawingCaches();
          } catch {
            // A failed wipe must not keep the session.
          }
          await supabase.auth.signOut();
        },
        confirm,
      };
    }

    async function accept(url: string | null, native: boolean) {
      if (!url || seen.has(url) || useFixtures || !hasSupabaseConfig) return;
      seen.add(url);
      const supabase = getSupabase();
      const outcome = native
        ? await settleNativeDeepLink({
            ...linkDeps(url),
            exchangeCode: async (code) => {
              const { data, error } = await supabase.auth.exchangeCodeForSession(code);
              return {
                error: error ? error.message : null,
                accessToken: error ? null : data.session?.access_token ?? null,
              };
            },
          })
        : await settleAuthLink(linkDeps(url));
      if (cancelled) return;
      if (outcome.status === 'applied') {
        writePending(true);
        setLinkError(null);
        setNeedsPassword(true);
        try {
          const me = await repo.me();
          if (!cancelled) setPerson(me);
        } catch {
          if (!cancelled) setPerson(null);
        }
      } else if (outcome.status === 'rejected') {
        if (outcome.signedOut) {
          writePending(false);
          setNeedsPassword(false);
          setPerson(null);
        }
        setLinkError(outcome.message);
      }
      if (!cancelled) setConfirmAccounts(null);
    }

    async function boot() {
      const captured = takeWebAuthUrl();
      let linkUrl = captured;
      if (Platform.OS !== 'web') {
        const initialUrl = await Linking.getInitialURL();
        if (initialUrl) linkUrl = initialUrl;
      }
      try {
        await accept(linkUrl, Platform.OS !== 'web');
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
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (Platform.OS === 'web') return;
      const next = captureIncomingLink(url);
      try {
        router.replace(next as never);
      } catch {
        // Navigation is not mounted yet. +native-intent already returned this path.
      }
      void accept(url, true);
    });
    return () => {
      cancelled = true;
      confirmResolve.current?.(false);
      confirmResolve.current = null;
      sub.remove();
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
        try {
          await deleteAllDrawingCaches();
        } catch {
          // A failed wipe must not keep the session.
        }
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
