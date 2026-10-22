import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';

test('build-apk.sh names the signing env and does not echo secret values', () => {
  const source = fs.readFileSync(new URL('./build-apk.sh', import.meta.url), 'utf8');
  for (const name of [
    'SITEPACK_KEYSTORE_PATH',
    'SITEPACK_KEYSTORE_PASSWORD',
    'SITEPACK_KEY_ALIAS',
    'SITEPACK_KEY_PASSWORD',
    'EXPO_PUBLIC_SUPABASE_URL',
    'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  ]) {
    assert.match(source, new RegExp(name));
  }
  assert.match(source, /83:C8:DD:E7:8A:3A:2B:A4:26:B6:CC:B4:DF:ED:CF:53:DC:DD:64:54:3C:28:11:A6:29:07:8F:07:49:16:57:B6/);
  assert.match(source, /dist-apk\/sitepack-/);
  assert.match(source, /check-js-bundle\.mjs/);
  assert.match(source, /check-anon-key\.mjs/);
  assert.match(source, /trap cleanup EXIT/);
  assert.match(source, /git checkout -- "\$file"/);
  assert.match(source, /package\.json/);
  assert.doesNotMatch(source, /echo .*(PASSWORD|ANON_KEY|KEY_ALIAS)/);
});

test('build-apk.sh fails before prebuild when signing env is missing', () => {
  const result = spawnSync('bash', ['scripts/build-apk.sh'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME ?? '/tmp' },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SITEPACK_KEYSTORE_PATH/);
  assert.match(result.stderr, /SITEPACK_KEYSTORE_PASSWORD/);
  assert.match(result.stderr, /EXPO_PUBLIC_SUPABASE_ANON_KEY/);
  assert.equal(`${result.stdout}${result.stderr}`.includes('assembleRelease'), false);
  assert.equal(`${result.stdout}${result.stderr}`.includes('prebuild'), false);
});

test('build-apk.sh refuses a client key that is not publishable or anon before prebuild', () => {
  const marker = 'sb_secret_MUST_NOT_APPEAR_IN_OUTPUT_FAKE';
  const result = spawnSync('bash', ['scripts/build-apk.sh'], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME ?? '/tmp',
      SITEPACK_KEYSTORE_PATH: '/tmp/sitepack-missing.keystore',
      SITEPACK_KEYSTORE_PASSWORD: 'x',
      SITEPACK_KEY_ALIAS: 'x',
      SITEPACK_KEY_PASSWORD: 'x',
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: marker,
    },
  });
  assert.notEqual(result.status, 0);
  const output = `${result.stdout}${result.stderr}`;
  assert.match(output, /EXPO_PUBLIC_SUPABASE_ANON_KEY must start with sb_publishable_/);
  assert.equal(output.includes(marker), false);
  assert.equal(output.includes('prebuild'), false);
});
