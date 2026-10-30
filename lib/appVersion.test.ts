import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { formatAppVersionLine, readAppVersion } from './appVersion.ts';

test('the version line uses the installed build, then the embedded app config', () => {
  assert.equal(formatAppVersionLine({ version: '0.2.10', build: '13' }), 'SitePack 0.2.10 (13)');
  assert.equal(formatAppVersionLine({ name: 'SitePack', version: '0.2.10', build: null }), 'SitePack 0.2.10');
  assert.equal(formatAppVersionLine({ version: '  ', build: ' ' }), 'SitePack');
  assert.equal(
    readAppVersion({
      nativeApplicationVersion: '0.2.10',
      nativeBuildVersion: '13',
      configName: 'SitePack',
      configVersion: '9.9.9',
      configVersionCode: 1,
    }),
    'SitePack 0.2.10 (13)',
  );
  assert.equal(
    readAppVersion({
      nativeApplicationVersion: null,
      nativeBuildVersion: null,
      configName: 'SitePack',
      configVersion: '0.2.10',
      configVersionCode: 13,
    }),
    'SitePack 0.2.10 (13)',
  );
});

test('company settings reads the version at runtime and the release script does not bump it', () => {
  const page = fs.readFileSync(new URL('../app/(app)/company.tsx', import.meta.url), 'utf8');
  assert.match(page, /appVersionLine\(\)/);
  assert.doesNotMatch(page, /0\.2\.\d+/);
  assert.match(page, /<ArchivedSites \/>\s*<AppVersion \/>/);
  const member = page.slice(page.indexOf('function MemberCompany'), page.indexOf('function OwnerList'));
  assert.ok(member.lastIndexOf('<AppVersion />') > member.lastIndexOf('<SignOutRow'));
  const label = fs.readFileSync(new URL('./appVersionLabel.ts', import.meta.url), 'utf8');
  assert.match(label, /expo-application/);
  assert.match(label, /expo-constants/);
  assert.match(label, /nativeApplicationVersion/);
  assert.match(label, /nativeBuildVersion/);
  assert.match(label, /versionCode/);
  assert.doesNotMatch(label, /0\.2\.\d+/);

  const script = fs.readFileSync(new URL('../scripts/build-apk.sh', import.meta.url), 'utf8');
  assert.match(script, /require\('\.\/app\.json'\)\.expo\.version/);
  assert.doesNotMatch(script, /versionCode\s*\+|versionCode\s*=/);
  assert.equal(fs.existsSync(new URL('../app.config.js', import.meta.url)), false);
  assert.equal(fs.existsSync(new URL('../app.config.ts', import.meta.url)), false);
  const app = JSON.parse(fs.readFileSync(new URL('../app.json', import.meta.url), 'utf8')) as {
    expo: { version: string; android: { versionCode: number } };
  };
  assert.equal(app.expo.version, '0.2.12');
  assert.equal(app.expo.android.versionCode, 15);
});
