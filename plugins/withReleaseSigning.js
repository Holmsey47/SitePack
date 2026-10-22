const { withAppBuildGradle } = require('expo/config-plugins');

const RELEASE_SIGNING = `
        release {
            def sitepackStorePath = System.getenv("SITEPACK_KEYSTORE_PATH")
            def sitepackStorePassword = System.getenv("SITEPACK_KEYSTORE_PASSWORD")
            def sitepackKeyAlias = System.getenv("SITEPACK_KEY_ALIAS")
            def sitepackKeyPassword = System.getenv("SITEPACK_KEY_PASSWORD")
            if (sitepackStorePath != null && !sitepackStorePath.isEmpty()
                    && sitepackStorePassword != null && !sitepackStorePassword.isEmpty()
                    && sitepackKeyAlias != null && !sitepackKeyAlias.isEmpty()
                    && sitepackKeyPassword != null && !sitepackKeyPassword.isEmpty()) {
                storeFile file(sitepackStorePath)
                storePassword sitepackStorePassword
                keyAlias sitepackKeyAlias
                keyPassword sitepackKeyPassword
            }
        }`;

const RELEASE_LINE = 'signingConfig signingConfigs.release';

// Runs only when a release package task is in the graph, so assembleDebug still works with no keystore.
const RELEASE_GUARD = `
gradle.taskGraph.whenReady {
    def buildingRelease = gradle.taskGraph.allTasks.any { task ->
        task.project.path == project.path && (
            task.name == "assembleRelease" ||
            task.name == "bundleRelease" ||
            task.name == "packageRelease" ||
            task.name == "signReleaseBundle"
        )
    }
    if (!buildingRelease) {
        return
    }
    def required = [
        "SITEPACK_KEYSTORE_PATH",
        "SITEPACK_KEYSTORE_PASSWORD",
        "SITEPACK_KEY_ALIAS",
        "SITEPACK_KEY_PASSWORD",
    ]
    def missing = required.findAll { name ->
        def value = System.getenv(name)
        value == null || value.isEmpty()
    }
    if (!missing.isEmpty()) {
        throw new GradleException("Release signing is missing " + missing.join(", ") + ".")
    }
}
`;

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
  if (!next.includes('sitepackRequireReleaseSigning') && !next.includes('buildingRelease')) {
    next = `${next.trimEnd()}\n${RELEASE_GUARD}`;
  }
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
