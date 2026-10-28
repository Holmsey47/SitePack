const { withGradleProperties } = require('expo/config-plugins');

const KEY = 'reactNativeArchitectures';
const ARM64 = 'arm64-v8a';

// android/ is prebuild output. This is the property Gradle reads for every
// native ABI, so a release APK built after prebuild contains arm64-v8a only.
function setReactNativeArchitectures(properties) {
  const existing = properties.find((item) => item.type === 'property' && item.key === KEY);
  if (existing) {
    existing.value = ARM64;
    return properties;
  }
  properties.push({ type: 'property', key: KEY, value: ARM64 });
  return properties;
}

function withArm64Architectures(config) {
  return withGradleProperties(config, (mod) => {
    mod.modResults = setReactNativeArchitectures(mod.modResults);
    return mod;
  });
}

module.exports = withArm64Architectures;
module.exports.setReactNativeArchitectures = setReactNativeArchitectures;
