import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { anonKeyProblem, clientKeyMessage } from './anonKey.mjs';
import { inspectBundleText, scanDirectory } from './check-js-bundle.mjs';

function fakeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = Buffer.from('fake-signature-not-a-secret').toString('base64url');
  return `${header}.${body}.${sig}`;
}

const anonJwt = fakeJwt({ role: 'anon', ref: 'fake-test-not-a-secret' });
const serviceJwt = fakeJwt({ role: 'service_role', ref: 'fake-test-not-a-secret' });
const secretKey = `sb_secret_${'FAKE'.repeat(8)}`;
const pem = '-----BEGIN RSA PRIVATE KEY-----\nFAKEFAKEFAKE\n-----END RSA PRIVATE KEY-----';

test('a fake anon JWT is accepted and a secret-shaped client key is refused without printing it', () => {
  assert.equal(anonKeyProblem(anonJwt), null);
  assert.equal(anonKeyProblem('sb_publishable_fake_test_key'), null);
  assert.equal(anonKeyProblem(serviceJwt), 'rejected');
  assert.equal(anonKeyProblem(secretKey), 'rejected');
  assert.equal(anonKeyProblem('test-anon-key-not-a-secret'), 'rejected');

  const message = clientKeyMessage({ EXPO_PUBLIC_SUPABASE_ANON_KEY: secretKey });
  assert.match(message, /EXPO_PUBLIC_SUPABASE_ANON_KEY must start with sb_publishable_/);
  assert.equal(message.includes(secretKey), false);
  assert.equal(message.includes(serviceJwt), false);

  const publishable = clientKeyMessage({ EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: serviceJwt });
  assert.match(publishable, /EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  assert.equal(publishable.includes(serviceJwt), false);
});

test('the bundle scan allows a fake anon JWT and rejects a fake service role, sb_secret key, and PEM', () => {
  assert.equal(
    inspectBundleText(anonJwt).some((finding) => finding.kind === 'jwt'),
    false
  );
  const prefixOnly = "value.startsWith('sb_secret_') || error === 'secret_key_missing'";
  assert.equal(
    inspectBundleText(prefixOnly).some((finding) => finding.kind === 'sb_secret'),
    false
  );

  const broken = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"role":').toString('base64url')}.${Buffer.from('x').toString('base64url')}padding`;
  const undecodable = inspectBundleText(broken).find((finding) => finding.kind === 'jwt');
  assert.equal(undecodable?.detail, 'undecodable jwt with a role claim');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sitepack-bundle-'));
  const file = path.join(dir, 'app.js');
  fs.writeFileSync(file, `const anon = ${JSON.stringify(anonJwt)};\nconst bad = ${JSON.stringify(serviceJwt)};\nconst key = ${JSON.stringify(secretKey)};\n${pem}\n`);
  const lines = scanDirectory(dir);
  const text = lines.join('\n');
  assert.match(text, /jwt role is not anon/);
  assert.match(text, /sb_secret key/);
  assert.match(text, /private key block/);
  assert.match(text, /offset \d+/);
  assert.equal(text.includes(serviceJwt), false);
  assert.equal(text.includes(secretKey), false);
  assert.equal(text.includes('FAKEFAKEFAKE'), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('check-anon-key prints the variable name and not the fake key', () => {
  const marker = 'sb_secret_MUST_NOT_APPEAR_IN_OUTPUT_FAKE';
  const result = spawnSync('node', ['scripts/check-anon-key.mjs'], {
    encoding: 'utf8',
    env: { ...process.env, EXPO_PUBLIC_SUPABASE_ANON_KEY: marker, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '' },
  });
  assert.notEqual(result.status, 0);
  const output = `${result.stdout}${result.stderr}`;
  assert.match(output, /EXPO_PUBLIC_SUPABASE_ANON_KEY must start with sb_publishable_/);
  assert.equal(output.includes(marker), false);
});
