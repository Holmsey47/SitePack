import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  AUTH_LINK_MAX_AGE_SECONDS,
  INVALID_AUTH_LINK,
  assessAuthLinkClaims,
  confirmSessionMessage,
  planBrowserUrl,
  sessionTokensFromUrl,
  settleAuthLink,
  type ExistingSession,
} from './authLink.ts';

const NOW = 1_700_000_000;

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.sig`;
}

function token(input: {
  amr: unknown;
  iat?: number;
  sub?: string;
  email?: string | null;
}): string {
  return jwt({
    sub: input.sub ?? 'person-new',
    email: input.email === undefined ? 'new.person@site.test' : input.email,
    amr: input.amr,
    iat: input.iat ?? NOW - 60,
  });
}

function hashUrl(path: string, accessToken: string, refreshToken = 'refresh-1'): string {
  return `https://sitepack-preview.vercel.app${path}#access_token=${encodeURIComponent(accessToken)}&refresh_token=${encodeURIComponent(refreshToken)}&type=invite`;
}

const freshInvite = () => token({ amr: [{ method: 'otp', timestamp: NOW - 60 }] });

test('session tokens in the query are refused, including on set-password', () => {
  const accessToken = freshInvite();
  const query = `https://sitepack-preview.vercel.app/set-password?access_token=${encodeURIComponent(accessToken)}&refresh_token=refresh-1&type=invite`;
  assert.equal(sessionTokensFromUrl(query), null);
  const planned = planBrowserUrl(query);
  assert.equal(planned.sessionUrl, null);
  assert.equal(planned.stripped, true);
  assert.equal(planned.nextHref.includes('access_token'), false);
  assert.equal(planned.nextHref.includes('refresh_token'), false);
});

test('a query token cannot override the hash token', () => {
  const parsed = sessionTokensFromUrl(
    'https://sitepack-preview.vercel.app/set-password?access_token=from-query&refresh_token=query-refresh#access_token=from-hash&refresh_token=hash-refresh'
  );
  assert.deepEqual(parsed, {
    accessToken: 'from-hash',
    refreshToken: 'hash-refresh',
    purpose: 'invite',
  });
});

test('the PKCE code query is left untouched', () => {
  const href = 'https://sitepack-preview.vercel.app/set-password?code=pkce-code';
  assert.equal(sessionTokensFromUrl(href), null);
  assert.deepEqual(planBrowserUrl(href), { nextHref: href, stripped: false, sessionUrl: null });
});

test('hash tokens on any path other than set-password or reset are refused and not held', () => {
  const href = hashUrl('/sites', freshInvite());
  assert.equal(sessionTokensFromUrl(href), null);
  const planned = planBrowserUrl(href);
  assert.equal(planned.sessionUrl, null);
  assert.equal(planned.nextHref, '/sites');
  assert.equal(sessionTokensFromUrl(hashUrl('/join/AB12', freshInvite())), null);
  assert.equal(sessionTokensFromUrl('https://sitepack-preview.vercel.app/reset/a/b#access_token=a&refresh_token=b'), null);
});

test('a fresh otp or invite hash on set-password is accepted', () => {
  for (const amr of [[{ method: 'otp', timestamp: NOW }], [{ method: 'invite', timestamp: NOW }], ['otp']]) {
    const accessToken = token({ amr, iat: NOW - 30 });
    const parsed = sessionTokensFromUrl(hashUrl('/set-password', accessToken));
    assert.equal(parsed?.purpose, 'invite');
    assert.equal(assessAuthLinkClaims(accessToken, 'invite', NOW).ok, true);
  }
  const resetCode = token({ amr: [{ method: 'recovery' }], iat: NOW - 10 });
  assert.equal(sessionTokensFromUrl(hashUrl('/reset/AB12-CD34', resetCode))?.purpose, 'recovery');
  assert.equal(assessAuthLinkClaims(resetCode, 'recovery', NOW).ok, true);
  const resetOtp = token({ amr: [{ method: 'otp' }] });
  assert.equal(assessAuthLinkClaims(resetOtp, 'recovery', NOW).ok, true);
});

test('the URL type string is ignored: amr and the path decide', () => {
  const password = token({ amr: [{ method: 'password' }] });
  const lying = `https://sitepack-preview.vercel.app/set-password#access_token=${password}&refresh_token=refresh-1&type=invite`;
  const parsed = sessionTokensFromUrl(lying);
  assert.equal(parsed?.purpose, 'invite');
  assert.equal(assessAuthLinkClaims(password, 'invite', NOW).ok, false);
  const recoveryOnInvite = token({ amr: [{ method: 'recovery' }] });
  assert.equal(assessAuthLinkClaims(recoveryOnInvite, 'invite', NOW).ok, false);
  const magiclink = token({ amr: [{ method: 'magiclink' }] });
  assert.equal(assessAuthLinkClaims(magiclink, 'invite', NOW).ok, false);
  assert.equal(assessAuthLinkClaims(magiclink, 'recovery', NOW).ok, false);
});

test('a stale or future iat is refused, and exactly 15 minutes is still allowed', () => {
  const freshEnough = token({ amr: [{ method: 'otp' }], iat: NOW - AUTH_LINK_MAX_AGE_SECONDS });
  assert.equal(assessAuthLinkClaims(freshEnough, 'invite', NOW).ok, true);
  const stale = token({ amr: [{ method: 'otp' }], iat: NOW - AUTH_LINK_MAX_AGE_SECONDS - 1 });
  assert.equal(assessAuthLinkClaims(stale, 'invite', NOW).ok, false);
  const skewed = token({ amr: [{ method: 'invite' }], iat: NOW + 60 });
  assert.equal(assessAuthLinkClaims(skewed, 'invite', NOW).ok, true);
  const future = token({ amr: [{ method: 'invite' }], iat: NOW + 61 });
  assert.equal(assessAuthLinkClaims(future, 'invite', NOW).ok, false);
  const missingIat = jwt({ sub: 'person-new', email: 'new.person@site.test', amr: [{ method: 'otp' }] });
  assert.equal(assessAuthLinkClaims(missingIat, 'invite', NOW).ok, false);
});

test('an existing session is not replaced until the person confirms', async () => {
  const calls: string[] = [];
  const accessToken = freshInvite();
  const outcome = await settleAuthLink({
    url: hashUrl('/set-password', accessToken),
    now: NOW,
    getExisting: async () => {
      calls.push('getExisting');
      const existing: ExistingSession = {
        state: 'signed-in',
        identity: { id: 'victim', email: 'victim@site.test' },
      };
      return existing;
    },
    verifyToken: async () => {
      calls.push('verify');
      return { id: 'attacker', email: 'attacker@site.test' };
    },
    setSession: async () => {
      calls.push('setSession');
      return { error: null };
    },
    signOut: async () => {
      calls.push('signOut');
    },
    confirm: async (message) => {
      calls.push('confirm');
      assert.equal(
        message,
        confirmSessionMessage(
          { id: 'victim', email: 'victim@site.test' },
          'attacker@site.test'
        )
      );
      assert.equal(message, "You're signed in as victim@site.test. This link is for attacker@site.test. Sign out and continue?");
      return false;
    },
  });
  assert.equal(outcome.status, 'declined');
  assert.deepEqual(calls, ['getExisting', 'verify', 'confirm']);
});

test('confirming signs out before setSession, and the same account does not ask', async () => {
  const accessToken = token({ amr: [{ method: 'invite' }], sub: 'same-person', email: 'same@site.test' });
  const confirmed: string[] = [];
  const accepted = await settleAuthLink({
    url: hashUrl('/set-password', accessToken),
    now: NOW,
    getExisting: async () => ({ state: 'signed-in', identity: { id: 'same-person', email: 'same@site.test' } }),
    verifyToken: async () => ({ id: 'same-person', email: 'same@site.test' }),
    setSession: async () => {
      confirmed.push('setSession');
      return { error: null };
    },
    signOut: async () => {
      confirmed.push('signOut');
    },
    confirm: async () => {
      throw new Error('same account must not ask');
    },
  });
  assert.equal(accepted.status, 'applied');
  assert.deepEqual(confirmed, ['setSession']);

  const order: string[] = [];
  const switched = await settleAuthLink({
    url: hashUrl('/reset', token({ amr: [{ method: 'recovery' }], email: 'other@site.test', sub: 'other' })),
    now: NOW,
    getExisting: async () => ({ state: 'signed-in', identity: { id: 'victim', email: 'victim@site.test', username: 'ada' } }),
    verifyToken: async () => null,
    setSession: async () => {
      order.push('setSession');
      return { error: null };
    },
    signOut: async () => {
      order.push('signOut');
    },
    confirm: async (message) => {
      order.push('confirm');
      assert.match(message, /You're signed in as victim@site\.test/);
      assert.match(message, /This link is for other@site\.test/);
      return true;
    },
  });
  assert.equal(switched.status, 'applied');
  assert.deepEqual(order, ['confirm', 'signOut', 'setSession']);
});

test('a mismatched amr or a stale iat never calls setSession', async () => {
  for (const accessToken of [
    token({ amr: [{ method: 'password' }] }),
    token({ amr: [{ method: 'otp' }], iat: NOW - AUTH_LINK_MAX_AGE_SECONDS - 5 }),
  ]) {
    let setCalls = 0;
    const outcome = await settleAuthLink({
      url: hashUrl('/set-password', accessToken),
      now: NOW,
      getExisting: async () => ({ state: 'signed-in', identity: { id: 'victim', email: 'victim@site.test' } }),
      verifyToken: async () => {
        throw new Error('bad claims must not be verified');
      },
      setSession: async () => {
        setCalls += 1;
        return { error: null };
      },
      signOut: async () => undefined,
      confirm: async () => {
        throw new Error('bad claims must not ask');
      },
    });
    assert.equal(outcome.status, 'rejected');
    assert.equal(outcome.status === 'rejected' && outcome.message, INVALID_AUTH_LINK);
    assert.equal(setCalls, 0);
  }
});

test('when setSession fails the link is discarded and signed out', async () => {
  const calls: string[] = [];
  const outcome = await settleAuthLink({
    url: hashUrl('/set-password', freshInvite()),
    now: NOW,
    getExisting: async () => ({ state: 'none' }),
    verifyToken: async () => {
      throw new Error('no session, so the token is not pre-verified');
    },
    setSession: async () => {
      calls.push('setSession');
      return { error: 'bad refresh' };
    },
    signOut: async () => {
      calls.push('signOut');
    },
    confirm: async () => true,
  });
  assert.deepEqual(outcome, { status: 'rejected', message: INVALID_AUTH_LINK, signedOut: true });
  assert.deepEqual(calls, ['setSession', 'signOut']);
});

test('the address bar is cleared before boot awaits the network', () => {
  const source = fs.readFileSync(new URL('../context/AuthContext.tsx', import.meta.url), 'utf8');
  const stripAt = source.indexOf('ensureWebAuthUrlStripped()');
  const bootAt = source.indexOf('async function boot');
  const boot = source.slice(bootAt, source.indexOf('settleAuthLink', bootAt));
  assert.ok(stripAt !== -1 && bootAt !== -1 && stripAt < bootAt);
  assert.ok(boot.includes('takeWebAuthUrl()'));
  assert.ok(boot.indexOf('takeWebAuthUrl()') < boot.indexOf('await'));
  assert.equal(source.includes('localStorage?.setItem(PENDING_KEY'), true);
  assert.doesNotMatch(source, /sessionStorage/);
  assert.doesNotMatch(source, /localStorage[\s\S]{0,80}accessToken/);
  const confirm = fs.readFileSync(new URL('../components/auth-link-confirm.tsx', import.meta.url), 'utf8');
  assert.match(confirm, /Sign out and continue/);
  assert.match(confirm, /Stay signed in/);
  assert.match(confirm, /minHeight=\{theme\.thumb\}/);
  const setPassword = fs.readFileSync(new URL('../app/(auth)/set-password.tsx', import.meta.url), 'utf8');
  assert.match(setPassword, /Setting a password for /);
  assert.match(setPassword, /Not you\? Sign out/);
});
