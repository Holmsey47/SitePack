import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { resolveInviteRedirect } from '../supabase/functions/_shared/inviteRedirect.ts';

test('an unset invite redirect is an error', () => {
  for (const raw of [undefined, null, '', '   ']) {
    assert.deepEqual(resolveInviteRedirect(raw), { ok: false, error: 'invite_redirect_not_configured' });
  }
});

test('localhost http invite redirects are allowed', () => {
  assert.deepEqual(resolveInviteRedirect('http://127.0.0.1:8081/set-password'), {
    ok: true,
    redirectTo: 'http://127.0.0.1:8081/set-password',
  });
  assert.deepEqual(resolveInviteRedirect('http://localhost:8081/set-password'), {
    ok: true,
    redirectTo: 'http://localhost:8081/set-password',
  });
  assert.deepEqual(resolveInviteRedirect('  HTTP://LOCALHOST:8081/set-password  '), {
    ok: true,
    redirectTo: 'HTTP://LOCALHOST:8081/set-password',
  });
});

test('https production invite redirects are allowed', () => {
  const redirectTo = 'https://sitepack-preview.vercel.app/set-password';
  assert.deepEqual(resolveInviteRedirect(redirectTo), { ok: true, redirectTo });
});

test('other http invite redirects are rejected', () => {
  for (const raw of [
    'http://example.com/set-password',
    'http://192.168.0.8:8081/set-password',
    'http://127.0.0.1.evil.com/set-password',
    'http://localhost.evil.com/set-password',
    'ftp://sitepack-preview.vercel.app/set-password',
    'not a url',
    'sitepack://set-password',
  ]) {
    assert.deepEqual(resolveInviteRedirect(raw), { ok: false, error: 'invite_redirect_not_configured' });
  }
});

test('invite-person asks the helper and has no localhost fallback', () => {
  const source = fs.readFileSync('supabase/functions/invite-person/index.ts', 'utf8');
  assert.equal(source.includes('127.0.0.1'), false);
  assert.equal(source.includes('http://127.0.0.1:8081/set-password'), false);
  assert.equal(source.split('const redirectTo = inviteRedirectOrError()').length - 1, 2);
  assert.match(source, /resolveInviteRedirect/);
  assert.match(source, /error: decision\.error \}, 500\)/);
  const repo = fs.readFileSync('data/supabaseRepo.ts', 'utf8');
  assert.match(repo, /inviteFailureMessage\(bodyError, error\.message\)/);
  const screen = fs.readFileSync('app/(app)/invite.tsx', 'utf8');
  assert.match(screen, /setError\(err instanceof Error \? err\.message : 'Invite failed'\)/);
});
