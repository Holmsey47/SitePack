import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { setReactNativeArchitectures } = require('../plugins/withArm64Architectures.js');

test('prebuild keeps reactNativeArchitectures at arm64-v8a', () => {
  const app = JSON.parse(fs.readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
  assert.ok(app.expo.plugins.includes('./plugins/withArm64Architectures.js'));
  const signing = fs.readFileSync(new URL('../plugins/withReleaseSigning.js', import.meta.url), 'utf8');
  assert.equal(signing.includes('reactNativeArchitectures'), false);

  const sample = [
    { type: 'comment', value: 'abi list' },
    { type: 'property', key: 'reactNativeArchitectures', value: 'armeabi-v7a,arm64-v8a,x86,x86_64' },
    { type: 'property', key: 'newArchEnabled', value: 'true' },
  ];
  const next = setReactNativeArchitectures(sample.map((item) => ({ ...item })));
  assert.equal(next.find((item) => item.key === 'reactNativeArchitectures').value, 'arm64-v8a');
  assert.equal(next.find((item) => item.key === 'newArchEnabled').value, 'true');

  const added = setReactNativeArchitectures([{ type: 'property', key: 'hermesEnabled', value: 'true' }]);
  assert.deepEqual(
    added.map((item) => (item.type === 'property' ? [item.key, item.value] : item)),
    [
      ['hermesEnabled', 'true'],
      ['reactNativeArchitectures', 'arm64-v8a'],
    ]
  );
  assert.equal(setReactNativeArchitectures(added).find((item) => item.key === 'reactNativeArchitectures').value, 'arm64-v8a');
  assert.equal(added.filter((item) => item.key === 'reactNativeArchitectures').length, 1);
});
