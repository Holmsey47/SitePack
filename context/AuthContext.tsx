import { repo, useFixtures } from '@/data/index';
import { inviteGrantFromUrl } from '@/lib/inviteGrant';
import { getSupabase, hasSupabaseConfig } from '@/lib/supabase';
import type { Person } from '@/data/types';
import * as Linking from 'expo-linking';
import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

type AuthState = {
  ready: boolean;
  person: Person | null;
  needsPassword: boolean;
  usingFixtures: boolean;
  signIn: (email: string, password: string) => Promise<void>;
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

function clearInviteHash() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.hash = '';
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
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
      const grant = inviteGrantFromUrl(pageUrl) ?? inviteGrantFromUrl(initialUrl);
      if (grant && !useFixtures && hasSupabaseConfig) {
        const { error } = await getSupabase().auth.setSession({
          access_token: grant.accessToken,
          refresh_token: grant.refreshToken,
        });
        if (!error) {
          writePending(true);
          clearInviteHash();
        }
      }
      if (!useFixtures && hasSupabaseConfig) {
        const supabase = getSupabase();
        supabase.auth.onAuthStateChange(async (event, session) => {
          if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
            if (urlLooksLikeInvite(typeof window !== 'undefined' ? window.location.href : initialUrl)) {
              writePending(true);
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
      if (urlLooksLikeInvite(url)) {
        writePending(true);
        setNeedsPassword(true);
      }
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
        const result = await repo.signIn(email, password);
        setPerson(result.person);
        setNeedsPassword(result.needsPassword || readPending());
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

