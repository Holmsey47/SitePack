import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fixtureRepo, resetFixtureStore } from '../data/fixtureRepo.ts';
import { SEED_PASSWORD } from '../data/ids.ts';
import {
  LOGIN_HONEST,
  LOGIN_NOT_SET_UP,
  LOGIN_OFFLINE,
  LOGIN_RATE,
  LOGIN_RECOVERY,
  loginFailureCode,
  presentLoginFailure,
  readLoginFunctionFailure,
} from './loginError.ts';

const strangerCases = [
  'sign_in_failed',
  'invalid_credentials',
  'user_not_found',
  'email_not_confirmed',
  'Invalid login credentials',
  'Email not confirmed',
  'User not found',
];

test('a stranger gets one message for a wrong password and an unknown account', () => {
  const messages = strangerCases.map((code) => presentLoginFailure(code));
  for (const presented of messages) {
    assert.equal(presented.message, LOGIN_HONEST);
    assert.equal(presented.showRecovery, true);
    assert.equal(presented.message.includes('Wrong password'), false);
    assert.equal(presented.message.includes('not found'), false);
    assert.equal(presented.message.includes('@'), false);
  }
  assert.equal(LOGIN_RECOVERY, 'Forgot password / use your join link');
  assert.notEqual(presentLoginFailure('account_not_set_up').message, LOGIN_HONEST);
  assert.equal(presentLoginFailure('account_not_set_up').message, LOGIN_NOT_SET_UP);
  assert.equal(presentLoginFailure('account_not_set_up').showRecovery, true);
  assert.equal(presentLoginFailure('rate_limited').message, LOGIN_RATE);
  assert.equal(presentLoginFailure('rate_limited').showRecovery, false);
  assert.equal(presentLoginFailure('offline').message, LOGIN_OFFLINE);
  assert.equal(presentLoginFailure('offline').showRecovery, false);
  assert.equal(presentLoginFailure('Failed to fetch').message, LOGIN_OFFLINE);
  assert.equal(loginFailureCode({ message: 'Email not confirmed', code: 'email_not_confirmed' }), 'sign_in_failed');
  assert.equal(loginFailureCode({ message: 'Invalid login credentials', code: 'invalid_credentials' }), 'sign_in_failed');
  assert.equal(loginFailureCode({ status: 429, message: 'Request rate limit reached' }), 'rate_limited');
  assert.equal(
    loginFailureCode({ message: 'For security purposes, you can only request this after 60 seconds' }),
    'rate_limited'
  );
  assert.equal(loginFailureCode({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' }), 'offline');
});

test('an edge login body cannot name a missing user, and a rate limit stays generic', async () => {
  const missed = await readLoginFunctionFailure({
    message: 'Edge Function returned a non-2xx status code',
    context: new Response(JSON.stringify({ error: 'user_not_found', email: 'someone@site.test' }), { status: 400 }),
  });
  const wrong = await readLoginFunctionFailure({
    message: 'Edge Function returned a non-2xx status code',
    context: new Response(JSON.stringify({ error: 'invalid_credentials' }), { status: 400 }),
  });
  const limited = await readLoginFunctionFailure({
    message: 'Edge Function returned a non-2xx status code',
    context: new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429 }),
  });
  const down = await readLoginFunctionFailure({
    name: 'FunctionsFetchError',
    message: 'Failed to send a request to the Edge Function',
  });
  assert.equal(missed, wrong);
  assert.equal(missed, 'sign_in_failed');
  assert.equal(limited, 'rate_limited');
  assert.equal(down, 'offline');

  const source = fs.readFileSync('supabase/functions/login-with-username/index.ts', 'utf8');
  const codes = [...source.matchAll(/error: '([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(codes)], ['sign_in_failed']);
  assert.match(source, /lookup_username_login/);
  assert.match(source, /note_login_failure/);
  assert.match(source, /padLoginMiss/);
  assert.doesNotMatch(source, /user_not_found|email_not_confirmed|invalid_credentials/);
  assert.doesNotMatch(source, /json\(\{[^}]*email/);
});

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : '';
}

test('fixture email and username failures do not say which one was wrong', async () => {
  resetFixtureStore();
  const unknownEmail = await fixtureRepo.signIn('nobody@sitepack.test', 'nope1234').then(() => '', failureMessage);
  const wrongPassword = await fixtureRepo.signIn('owner@sitepack.test', 'nope1234').then(() => '', failureMessage);
  assert.equal(unknownEmail, wrongPassword);
  assert.equal(unknownEmail, 'sign_in_failed');
  assert.equal(presentLoginFailure(unknownEmail).message, presentLoginFailure(wrongPassword).message);

  const unknownName = await fixtureRepo.signInWithUsername('nobodyuser', 'nope1234').then(() => '', failureMessage);
  const wrongNamePassword = await fixtureRepo.signInWithUsername('bentorres', 'nope1234').then(() => '', failureMessage);
  assert.equal(unknownName, wrongNamePassword);
  assert.equal(unknownName, 'sign_in_failed');
  assert.equal(presentLoginFailure(unknownName).message, LOGIN_HONEST);
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  assert.equal((await fixtureRepo.me())?.email, 'owner@sitepack.test');

  const screen = fs.readFileSync('app/(auth)/login.tsx', 'utf8');
  const repo = fs.readFileSync('data/supabaseRepo.ts', 'utf8');
  assert.match(screen, /LOGIN_RECOVERY/);
  assert.match(screen, /presentLoginFailure/);
  assert.doesNotMatch(screen, /Check username/);
  assert.match(repo, /account_not_set_up/);
  assert.match(repo, /loginFailureCode/);
  assert.doesNotMatch(repo, /Couldn’t sign in\. Check email/);
  assert.match(repo, /signOut\(\{ scope: 'local' \}\)/);
});
