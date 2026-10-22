import { repo, useFixtures } from '@/data/index';
import {
  browserPathWithoutAuth,
  consumePasswordSetup,
  peekAuthCallback,
  stashAuthCallback,
  takeAuthCallback,
} from '@/lib/appLinks';
import { inviteGrantFromUrl } from '@/lib/inviteGrant';
import { getSupabase, hasSupabaseConfig } from '@/lib/supabase';
import type { JoinWithCodeInput, Person } from '@/data/types';
import * as Linking from 'expo-linking';
import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

type AuthState = {
  ready: boolean;
  person: Person | null;
  needsPassword: boolean;
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

function urlLooksLikeInvite(url: string | null): boolean {
  return inviteGrantFromUrl(url) !== null;
}

function stripBrowserAuth(url: string | null) {
  if (typeof window === 'undefined' || !url) return;
  const next = browserPathWithoutAuth(url);
  if (!next) return;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next === current) return;
  window.history.replaceState(window.history.state, '', next);
}

function stashLaunchUrl(url: string | null) {
  stashAuthCallback(url, { native: Platform.OS !== 'web' });
}

async function nativeSessionAlreadyOpen(): Promise<boolean> {
  if (useFixtures || !hasSupabaseConfig) return false;
  try {
    const { data } = await getSupabase().auth.getSession();
    return Boolean(data.session);
  } catch {
    return false;
  }
}

/** setSession for hash tokens. exchangeCodeForSession for a native PKCE code. */
async function applyStashedAuth(): Promise<boolean> {
  const pending = takeAuthCallback();
  if (!pending) return false;
  const pageUrl = typeof window !== 'undefined' ? window.location.href : null;
  if (useFixtures || !hasSupabaseConfig) {
    stripBrowserAuth(pageUrl);
    return false;
  }
  if (pending.kind === 'session') {
    const { error } = await getSupabase().auth.setSession({
      access_token: pending.accessToken,
      refresh_token: pending.refreshToken,
    });
    stripBrowserAuth(pageUrl);
    return !error;
  }
  if (Platform.OS === 'web') {
    await getSupabase().auth.getSession();
    stripBrowserAuth(pageUrl);
    return false;
  }
  const { error } = await getSupabase().auth.exchangeCodeForSession(pending.code);
  return !error;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [person, setPerson] = useState<Person | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const initialUrl = await Linking.getInitialURL();
      const pageUrl = typeof window !== 'undefined' ? window.location.href : initialUrl;
      stashLaunchUrl(pageUrl);
      if (initialUrl && initialUrl !== pageUrl) stashLaunchUrl(initialUrl);
      if (!useFixtures && hasSupabaseConfig) {
        const supabase = getSupabase();
        supabase.auth.onAuthStateChange(async (event, session) => {
          if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
            const page = typeof window !== 'undefined' ? window.location.href : initialUrl;
            if (urlLooksLikeInvite(page) || consumePasswordSetup()) {
              writePending(true);
              if (!cancelled) setNeedsPassword(true);
            }
          }
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
      const accepted = await applyStashedAuth();
      if (accepted) writePending(true);
      try {
        const me = await repo.restoreSession();
        if (!cancelled) {
          setPerson(me);
          setNeedsPassword(Boolean(me) && readPending());
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    void boot();
    const sub = Linking.addEventListener('url', ({ url }) => {
      stashLaunchUrl(url);
      void (async () => {
        if (Platform.OS !== 'web' && (await nativeSessionAlreadyOpen()) && peekAuthCallback()?.kind === 'session') {
          takeAuthCallback();
          consumePasswordSetup();
          return;
        }
        const accepted = await applyStashedAuth();
        if (!accepted) return;
        writePending(true);
        if (!cancelled) setNeedsPassword(true);
        try {
          const me = await repo.me();
          if (!cancelled) setPerson(me);
        } catch {
          if (!cancelled) setPerson(null);
        }
      })();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      person,
      needsPassword,
      usingFixtures: useFixtures,
      signIn: async (email, password) => {
        consumePasswordSetup();
        const result = await repo.signIn(email, password);
        setPerson(result.person);
        setNeedsPassword(result.needsPassword || readPending());
      },
      signInWithUsername: async (username, password) => {
        consumePasswordSetup();
        const result = await repo.signInWithUsername(username, password);
        setPerson(result.person);
        setNeedsPassword(false);
      },
      joinWithCode: async (input) => {
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
    [ready, person, needsPassword]
  );

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

