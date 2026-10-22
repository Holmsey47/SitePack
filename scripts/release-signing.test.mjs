import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { applyReleaseSigning } = require('../plugins/withReleaseSigning.js');

const sample = `
android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
        }
    }
}
`;

test('release signing reads the keystore from the environment and leaves debug signing alone', () => {
  const gradle = applyReleaseSigning(sample);
  assert.match(gradle, /storePassword System\.getenv\("SITEPACK_KEYSTORE_PASSWORD"\)/);
  assert.match(gradle, /keyAlias System\.getenv\("SITEPACK_KEY_ALIAS"\)/);
  assert.match(gradle, /keyPassword System\.getenv\("SITEPACK_KEY_PASSWORD"\)/);
  assert.match(gradle, /storeFile file\(sitepackStorePath\)/);
  assert.match(
    gradle,
    /signingConfig System\.getenv\("SITEPACK_KEYSTORE_PATH"\) \? signingConfigs\.release : signingConfigs\.debug/
  );
  assert.match(gradle, /debug \{\s*signingConfig signingConfigs\.debug/s);
  assert.equal(gradle.includes("storePassword 'upload'"), false);
  assert.equal(applyReleaseSigning(gradle), gradle);
});
