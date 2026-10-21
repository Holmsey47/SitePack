import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { inviteFailureMessage } from './inviteError.ts';
import { mapInviteFailure } from '../supabase/functions/_shared/inviteFailure.ts';

test('a second invite of the same email says they are already in the company', () => {
  const message = inviteFailureMessage(
    'A user with this email address has already been registered',
    'Edge Function returned a non-2xx status code'
  );
  assert.equal(message, 'This person is already in the company and signs in with email and password.');
  assert.equal(message.includes('registered'), false);
});

test('an unknown invite failure does not show the raw error', () => {
  const message = inviteFailureMessage('email rate limit exceeded', 'Edge Function returned a non-2xx status code');
  assert.equal(message, 'The invite did not send. Try again.');
  assert.equal(message.includes('rate limit'), false);
  assert.equal(message.includes('non-2xx'), false);
});

test('a missing invite redirect is explained in plain words', () => {
  const message = inviteFailureMessage('invite_redirect_not_configured', 'Edge Function returned a non-2xx status code');
  assert.equal(message, 'The invite link is not set up, so the email was not sent.');
  assert.equal(message.includes('invite_redirect_not_configured'), false);
  assert.equal(message.includes('127.0.0.1'), false);
});

test('each invite code has plain words', () => {
  const cases: Array<[string, string]> = [
    ['not_authorized', 'You can’t do that.'],
    ['invalid_input', 'Check the email and name, then try again.'],
    ['person_not_found', 'That person is not in the company.'],
    ['already_member', 'This person is already in the company and signs in with email and password.'],
    ['invite_failed', 'The invite did not send. Try again.'],
    ['email_and_name_required', 'Enter an email and a name.'],
    ['invalid_role', 'Pick a role.'],
    ['site_not_found', 'That site is not in the company.'],
    ['email_required', 'Enter an email to attach the login.'],
    ['email_in_use', 'That email is already used in this company.'],
    ['already_has_login', 'This person already has a login.'],
  ];
  for (const [code, plain] of cases) {
    assert.equal(inviteFailureMessage(code, 'raw fallback'), plain);
  }
});

test('GoTrue and Postgres invite errors become fixed codes', () => {
  assert.deepEqual(
    mapInviteFailure({ message: 'A user with this email address has already been registered', code: 'email_exists' }, 'auth'),
    { code: 'already_member', status: 409 }
  );
  assert.deepEqual(mapInviteFailure({ message: 'Unable to validate email address: invalid format' }, 'auth'), {
    code: 'invalid_input',
    status: 400,
  });
  assert.deepEqual(mapInviteFailure({ message: 'email rate limit exceeded' }, 'auth'), {
    code: 'invite_failed',
    status: 400,
  });
  assert.deepEqual(mapInviteFailure({ code: '23505', message: 'duplicate key value violates unique constraint' }, 'person'), {
    code: 'already_member',
    status: 409,
  });
  assert.deepEqual(
    mapInviteFailure({ code: '23503', message: 'insert or update on table "site_assignments" violates foreign key', details: 'person_id' }, 'assignment'),
    { code: 'person_not_found', status: 404 }
  );
  assert.deepEqual(mapInviteFailure(new SyntaxError('Unexpected token'), 'unexpected'), {
    code: 'invalid_input',
    status: 400,
  });
  assert.deepEqual(mapInviteFailure(new Error('database connection failed'), 'unexpected'), {
    code: 'invite_failed',
    status: 500,
  });
  const mapped = mapInviteFailure({ message: 'jwt malformed secret sk_live_abc', code: '42501' }, 'unexpected');
  assert.equal(mapped.code, 'not_authorized');
  assert.equal(JSON.stringify(mapped).includes('sk_live'), false);
});

test('invite-person does not send raw Supabase or GoTrue text', () => {
  const source = fs.readFileSync('supabase/functions/invite-person/index.ts', 'utf8');
  assert.equal(source.includes('inviteError?.message'), false);
  assert.equal(source.includes('personError?.message'), false);
  assert.equal(source.includes('assignError.message'), false);
  assert.equal(source.includes('error: message'), false);
  assert.match(source, /console\.error\(error\)/);
  assert.match(source, /mapInviteFailure/);
  const returned = source.slice(source.indexOf('function loggedFailure'));
  assert.match(returned, /error: mapped\.code/);
  assert.doesNotMatch(returned, /error\.message/);
});
