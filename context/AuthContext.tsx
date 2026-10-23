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
import { adoptCacheOwner, deleteAllDrawingCaches } from '@/lib/offline';
import { adoptTalkOwner, wipeTalkQueue } from '@/lib/talkQueue';
import { authStorage } from '@/lib/secureSession';
import { coldStartCache, userCheckOutcome, userIdFromStoredSession, type UserCheck } from '@/lib/sessionBoot';
import { repo, useFixtures } from '@/data/index';
import { getSupabase, hasSupabaseConfig } from '@/lib/supabase';
import type { JoinWithCodeInput, Person, Role } from '@/data/types';
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
const PERSON_KEY = 'sitepack.auth.person';

async function bindCache(userId: string | null) {
  try {
    if (userId) await adoptCacheOwner(userId);
    else {
      writeRemembered(null);
      await deleteAllDrawingCaches();
    }
  } catch {
    // A failed wipe must not keep the previous owner's drawings readable.
  }
  if (userId) {
    try {
      await adoptTalkOwner(userId);
    } catch {
      // Adopting the talk queue must not depend on the drawing wipe.
    }
  }
  if (!userId) {
    try {
      await wipeTalkQueue();
    } catch {
      // An earlier wipe throwing must not skip the talk queue.
    }
  }
}

function authTokenKey(): string | null {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  try {
    const host = new URL(url).hostname.split('.')[0];
    return host ? `sb-${host}-auth-token` : null;
  } catch {
    return null;
  }
}

/** The session blob in auth storage. getSession() drops it when an offline refresh fails. */
async function readStoredSessionUser(): Promise<{ userId: string; email: string | null } | null> {
  const key = authTokenKey();
  if (!key) return null;
  try {
    const raw = await authStorage().getItem(key);
    const userId = userIdFromStoredSession(raw);
    if (!userId) return null;
    const parsed = JSON.parse(raw as string) as { user?: { email?: unknown } };
    const email = parsed.user?.email;
    return { userId, email: typeof email === 'string' ? email : null };
  } catch {
    return null;
  }
}

function isRole(value: unknown): value is Role {
  return value === 'operative' || value === 'cm' || value === 'owner';
}

function readRemembered(userId: string): Person | null {
  try {
    const raw = globalThis.localStorage?.getItem(PERSON_KEY);
    if (!raw) return null;
    const person = JSON.parse(raw) as Person;
    if (person?.auth_user_id !== userId || !isRole(person.role) || typeof person.id !== 'string') return null;
    return person;
  } catch {
    return null;
  }
}

function writeRemembered(person: Person | null) {
  try {
    if (!person?.auth_user_id) globalThis.localStorage?.removeItem(PERSON_KEY);
    else globalThis.localStorage?.setItem(PERSON_KEY, JSON.stringify(person));
  } catch {
    // The in-memory person still signs this launch in.
  }
}

function personForOffline(userId: string, email: string | null): Person {
  return (
    readRemembered(userId) ?? {
      id: userId,
      auth_user_id: userId,
      company_id: '',
      role: 'operative',
      trade: null,
      display_name: null,
      email,
      phone: null,
      created_at: '',
    }
  );
}

async function classifyOnlineUser(): Promise<UserCheck> {
  try {
    const { data, error } = await getSupabase().auth.getUser();
    return userCheckOutcome(
      error ? { name: error.name, status: error.status, code: error.code } : null,
      Boolean(data.user?.id)
    );
  } catch {
    return 'offline';
  }
}

async function personForStoredUser(
  userId: string,
  email: string | null,
  online: UserCheck
): Promise<Person | null> {
  if (online === 'rejected') return null;
  if (online === 'offline') return personForOffline(userId, email);
  try {
    const me = await repo.me();
    if (me?.auth_user_id) {
      writeRemembered(me);
      return me;
    }
  } catch {
    // The session is valid. The profile call did not reach the server.
  }
  return personForOffline(userId, email);
}

/** Wipe only when storage has no session, or the server rejected the one it has. */
async function restoreStoredSession(): Promise<{ userId: string | null; person: Person | null; rejected: boolean }> {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  const fromClient = data.session?.user?.id
    ? { userId: data.session.user.id, email: data.session.user.email ?? null }
    : null;
  const stored = fromClient ?? (await readStoredSessionUser());
  if (!stored) return { userId: null, person: null, rejected: false };
  const online = await classifyOnlineUser();
  const decision = coldStartCache(stored.userId, online);
  if (decision.wipe || !decision.userId) return { userId: null, person: null, rejected: online === 'rejected' };
  const person = await personForStoredUser(decision.userId, stored.email, online);
  if (!person) return { userId: null, person: null, rejected: true };
  return { userId: decision.userId, person, rejected: false };
}

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
          await bindCache(null);
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
          if (me?.auth_user_id) {
            writeRemembered(me);
            await bindCache(me.auth_user_id);
          }
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
            const live = session?.user?.id
              ? { userId: session.user.id, email: session.user.email ?? null }
              : await readStoredSessionUser();
            if (!live) {
              await bindCache(null);
              if (!cancelled) setPerson(null);
              return;
            }
            const online = session?.user?.id ? await classifyOnlineUser() : 'offline';
            const decision = coldStartCache(live.userId, online);
            if (decision.wipe || !decision.userId) {
              await bindCache(null);
              if (online === 'rejected') {
                try {
                  await supabase.auth.signOut({ scope: 'local' });
                } catch {
                  // The stored session is already gone.
                }
              }
              if (!cancelled) setPerson(null);
              return;
            }
            await bindCache(decision.userId);
            const person = await personForStoredUser(decision.userId, live.email, online);
            if (!person) {
              await bindCache(null);
              if (!cancelled) setPerson(null);
              return;
            }
            if (!cancelled) setPerson(person);
          });
        }
        if (!useFixtures && hasSupabaseConfig) {
          const started = await restoreStoredSession();
          if (!cancelled) {
            if (started.userId) await bindCache(started.userId);
            else await bindCache(null);
            if (started.rejected) {
              try {
                await getSupabase().auth.signOut({ scope: 'local' });
              } catch {
                // The stored session is already gone.
              }
            }
            if (!cancelled) {
              setPerson(started.person);
              setNeedsPassword(Boolean(started.person) && readPending());
            }
          }
        } else {
          const me = await repo.restoreSession();
          if (!cancelled) {
            await bindCache(me?.auth_user_id ?? null);
            if (!cancelled) {
              if (me) writeRemembered(me);
              setPerson(me);
              setNeedsPassword(Boolean(me) && readPending());
            }
          }
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
        writeRemembered(result.person);
        await bindCache(result.person.auth_user_id);
        setPerson(result.person);
        setNeedsPassword(result.needsPassword || readPending());
      },
      signInWithUsername: async (username, password) => {
        setLinkError(null);
        const result = await repo.signInWithUsername(username, password);
        writeRemembered(result.person);
        await bindCache(result.person.auth_user_id);
        setPerson(result.person);
        setNeedsPassword(false);
      },
      joinWithCode: async (input) => {
        setLinkError(null);
        const result = await repo.joinWithCode(input);
        writeRemembered(result.person);
        await bindCache(result.person.auth_user_id);
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
        if (me?.auth_user_id) {
          writeRemembered(me);
          await bindCache(me.auth_user_id);
        }
        setPerson(me);
      },
      signOut: async () => {
        await bindCache(null);
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
        if (me?.auth_user_id) {
          writeRemembered(me);
          await bindCache(me.auth_user_id);
        }
        setPerson(me);
      },
      refresh: async () => {
        const me = await repo.me();
        if (me?.auth_user_id) {
          writeRemembered(me);
          await bindCache(me.auth_user_id);
        }
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
