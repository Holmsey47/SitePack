import assert from 'node:assert/strict';
import test from 'node:test';
import { inviteFailureMessage } from './inviteError.ts';

test('a second invite of the same email says they are already in the company', () => {
  const message = inviteFailureMessage(
    'A user with this email address has already been registered',
    'Edge Function returned a non-2xx status code'
  );
  assert.equal(
    message,
    'This person is already in the company and signs in with email and password.'
  );
});

test('an unknown invite failure keeps the function message', () => {
  assert.equal(inviteFailureMessage('email rate limit exceeded', 'fallback'), 'email rate limit exceeded');
});
