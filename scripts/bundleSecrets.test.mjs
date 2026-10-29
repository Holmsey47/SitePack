import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { clientKeyMessage, publishableKeyProblem } from './anonKey.mjs';
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

test('a publishable key is accepted and a legacy JWT or sb_secret_ key is refused without printing it', () => {
  assert.equal(publishableKeyProblem('sb_publishable_fake_test_key'), null);
  assert.equal(publishableKeyProblem(anonJwt), 'rejected');
  assert.equal(publishableKeyProblem(serviceJwt), 'rejected');
  assert.equal(publishableKeyProblem(secretKey), 'rejected');
  assert.equal(publishableKeyProblem('test-anon-key-not-a-secret'), 'rejected');
  assert.equal(publishableKeyProblem(''), 'missing');

  for (const marker of [secretKey, anonJwt]) {
    const message = clientKeyMessage({ EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: marker });
    assert.match(message, /EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY must start with sb_publishable_/);
    assert.equal(message.includes(marker), false);
  }
  assert.equal(clientKeyMessage({ EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fake_test_key' }), null);
  assert.match(
    clientKeyMessage({ EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_fake_test_key' }),
    /EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY must start with sb_publishable_/
  );
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

test('check-anon-key and export-web reject a legacy JWT and an sb_secret_ key without printing them', () => {
  const secret = 'sb_secret_MUST_NOT_APPEAR_IN_OUTPUT_FAKE';
  for (const marker of [secret, anonJwt]) {
    const checked = spawnSync('node', ['scripts/check-anon-key.mjs'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: marker },
    });
    assert.notEqual(checked.status, 0);
    const checkedOutput = `${checked.stdout}${checked.stderr}`;
    assert.match(checkedOutput, /EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY must start with sb_publishable_/);
    assert.equal(checkedOutput.includes(marker), false);

    const exported = spawnSync(process.execPath, ['scripts/export-web.mjs'], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: marker,
        EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_legacy_fallback_must_not_count',
      },
    });
    assert.notEqual(exported.status, 0);
    const exportedOutput = `${exported.stdout}${exported.stderr}`;
    assert.match(exportedOutput, /EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY must start with sb_publishable_/);
    assert.equal(exportedOutput.includes(marker), false);
    assert.equal(exportedOutput.includes('expo'), false);
  }
});
