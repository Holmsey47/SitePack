import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const CALL_SITES = [
  'app/(app)/sites/[siteId]/snags/new.tsx',
  'app/(app)/sites/[siteId]/snags/[snagId].tsx',
  'app/(app)/sites/[siteId]/variations/new.tsx',
];

test('the shared picker offers take photo and the gallery, and every photo slot uses it', () => {
  const picker = fs.readFileSync('components/PhotoPicker.tsx', 'utf8');
  assert.match(picker, /label="Take photo"/);
  assert.match(picker, /label="Choose from gallery"/);
  assert.match(picker, /requestCameraPermissionsAsync/);
  assert.match(picker, /launchCameraAsync/);
  assert.match(picker, /launchImageLibraryAsync/);
  assert.match(picker, /capture: 'environment'/);
  assert.match(picker, /Linking\.openSettings/);
  assert.match(picker, /minHeight=\{48\}/);
  assert.match(picker, /preparePhoto/);
  const take = picker.slice(picker.indexOf('async function takePhoto'), picker.indexOf('async function chooseGallery'));
  const gallery = picker.slice(picker.indexOf('async function chooseGallery'), picker.indexOf('function onWebFiles'));
  assert.ok(take.indexOf('await fromUri') < take.indexOf('onAdd'));
  assert.ok(gallery.indexOf('await fromUri') < gallery.indexOf('onAdd'));
  assert.match(picker, /fromBlob/);

  for (const site of CALL_SITES) {
    const source = fs.readFileSync(site, 'utf8');
    assert.match(source, /<PhotoPicker/);
    assert.doesNotMatch(source, /launchImageLibraryAsync|launchCameraAsync|expo-image-picker|createElement\('input'/);
  }

  const detail = fs.readFileSync(CALL_SITES[1], 'utf8');
  assert.match(detail, /title="Add after photo"/);
  assert.match(detail, /nativeID="mark-fixed-reason"/);
  assert.match(detail, /disabled=\{markFixedReason !== null\}/);
  const reasonAt = detail.indexOf('nativeID="mark-fixed-reason"');
  const buttonAt = detail.indexOf('label="Mark fixed"');
  assert.ok(reasonAt > 0 && buttonAt > reasonAt);
  assert.doesNotMatch(detail, /disabled=\{afterPhotos\.length < 1\}/);

  const hits: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'dist-android' || entry.name === '.git' || entry.name === 'android' || entry.name === 'ios') {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name) || entry.name === 'PhotoPicker.tsx' || entry.name === 'photoPicker.test.ts') continue;
      const text = fs.readFileSync(full, 'utf8');
      if (text.includes('launchImageLibraryAsync') || text.includes('launchCameraAsync')) hits.push(full);
    }
  }
  walk('.');
  assert.deepEqual(hits, []);
});

test('app.json asks for the camera in plain words and keeps the Android camera permission', () => {
  const app = JSON.parse(fs.readFileSync('app.json', 'utf8'));
  const plugin = app.expo.plugins.find((item: unknown) => Array.isArray(item) && item[0] === 'expo-image-picker');
  assert.ok(plugin);
  const options = plugin[1] as { photosPermission: string; cameraPermission: string | false; microphonePermission: unknown };
  assert.equal(options.photosPermission.includes('drawing request'), false);
  assert.match(options.photosPermission, /snag/i);
  assert.match(options.photosPermission, /variation/i);
  assert.equal(typeof options.cameraPermission, 'string');
  if (typeof options.cameraPermission !== 'string') throw new Error('camera permission missing');
  assert.match(options.cameraPermission, /camera/i);
  assert.equal(options.microphonePermission, false);
  assert.equal(app.expo.version, '0.2.1');
  assert.equal(app.expo.android.versionCode, 4);
  assert.ok(app.expo.android.permissions.includes('android.permission.CAMERA'));
  assert.equal(app.expo.android.blockedPermissions.includes('CAMERA'), false);
  const manifest = fs.readFileSync('scripts/check-android-manifest.mjs', 'utf8');
  assert.match(manifest, /android\.permission\.CAMERA must stay granted/);
});
