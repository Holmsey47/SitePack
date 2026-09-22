import assert from 'node:assert/strict';
import test from 'node:test';
import { inviteGrantFromUrl, spentInviteGuidance } from './inviteGrant.ts';

test('invite hash is the new person session', () => {
  const grant = inviteGrantFromUrl(
    'http://127.0.0.1:8081/set-password#access_token=aaa&refresh_token=bbb&type=invite'
  );
  assert.deepEqual(grant, { accessToken: 'aaa', refreshToken: 'bbb' });
});

test('a bare set-password page is not an invite', () => {
  assert.equal(inviteGrantFromUrl('http://127.0.0.1:8081/set-password'), null);
});

test('a page that still has the invite hash says reload, not open the email', () => {
  const message = spentInviteGuidance(
    'http://127.0.0.1:8081/set-password#access_token=aaa&refresh_token=bbb&type=invite'
  );
  assert.match(message, /Reload this page/);
  assert.doesNotMatch(message, /open the invite email again/i);
});

test('a page with no invite hash says the email cannot be opened again', () => {
  const message = spentInviteGuidance('http://127.0.0.1:8081/set-password');
  assert.equal(message, 'Stop. The email cannot be opened again.');
  assert.doesNotMatch(message, /open the email/i);
});

test('password login code is not an invite', () => {
  assert.equal(inviteGrantFromUrl('http://127.0.0.1:8081/set-password?code=abc'), null);
});
