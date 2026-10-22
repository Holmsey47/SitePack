const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('pdfjs');

// Production web builds must not ship fixture people or the seed password.
// EXPO_PUBLIC_USE_FIXTURES=1 keeps them for local fixture runs.
if (process.env.EXPO_PUBLIC_USE_FIXTURES !== '1') {
  const stub = path.resolve(__dirname, 'data/prodStub.ts');
  const blocked = ['data/fixtureRepo.ts', 'data/ids.ts'].map((file) => path.resolve(__dirname, file));
  const upstream = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    const resolved = upstream
      ? upstream(context, moduleName, platform)
      : context.resolveRequest(context, moduleName, platform);
    if (resolved && resolved.type === 'sourceFile' && blocked.includes(path.resolve(resolved.filePath))) {
      return { type: 'sourceFile', filePath: stub };
    }
    return resolved;
  };
}

module.exports = config;
