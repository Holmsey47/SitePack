const { withAppBuildGradle } = require('expo/config-plugins');

const RELEASE_SIGNING = `
        release {
            def sitepackStorePath = System.getenv("SITEPACK_KEYSTORE_PATH")
            if (sitepackStorePath != null && !sitepackStorePath.isEmpty()) {
                storeFile file(sitepackStorePath)
                storePassword System.getenv("SITEPACK_KEYSTORE_PASSWORD")
                keyAlias System.getenv("SITEPACK_KEY_ALIAS")
                keyPassword System.getenv("SITEPACK_KEY_PASSWORD")
            }
        }`;

const RELEASE_LINE =
  'signingConfig System.getenv("SITEPACK_KEYSTORE_PATH") ? signingConfigs.release : signingConfigs.debug';

function applyReleaseSigning(contents) {
  if (contents.includes('SITEPACK_KEYSTORE_PATH')) return contents;
  const signingAt = contents.indexOf('signingConfigs {');
  if (signingAt < 0) throw new Error('app/build.gradle has no signingConfigs block.');
  const insertAt = signingAt + 'signingConfigs {'.length;
  let next = `${contents.slice(0, insertAt)}${RELEASE_SIGNING}${contents.slice(insertAt)}`;
  const buildTypesAt = next.indexOf('buildTypes');
  if (buildTypesAt < 0) throw new Error('app/build.gradle has no buildTypes.');
  const releaseAt = next.indexOf('release {', buildTypesAt);
  if (releaseAt < 0) throw new Error('app/build.gradle has no release build type.');
  const open = next.indexOf('{', releaseAt);
  let depth = 0;
  let close = -1;
  for (let index = open; index < next.length; index += 1) {
    if (next[index] === '{') depth += 1;
    else if (next[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        close = index;
        break;
      }
    }
  }
  if (close < 0) throw new Error('app/build.gradle release build type is not closed.');
  const block = next.slice(releaseAt, close + 1);
  if (!/signingConfig\s+signingConfigs\.debug/.test(block)) {
    throw new Error('release build type does not use the debug signing config.');
  }
  const replaced = block.replace(/signingConfig\s+signingConfigs\.debug/, RELEASE_LINE);
  next = next.slice(0, releaseAt) + replaced + next.slice(close + 1);
  return next;
}

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') {
      throw new Error('SitePack release signing expects Groovy app/build.gradle.');
    }
    mod.modResults.contents = applyReleaseSigning(mod.modResults.contents);
    return mod;
  });
}

module.exports = withReleaseSigning;
module.exports.applyReleaseSigning = applyReleaseSigning;
