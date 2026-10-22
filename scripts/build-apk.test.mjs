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
