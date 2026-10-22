const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('pdfjs');

// pdf-lib's package "module" build pulls tslib in a shape Metro evaluates as
// `n.default` with no helpers. The rollup bundle inlines those helpers.
const pdfLib = path.resolve(__dirname, 'node_modules/pdf-lib/dist/pdf-lib.esm.js');
const stub = path.resolve(__dirname, 'data/prodStub.ts');
const blocked =
  process.env.EXPO_PUBLIC_USE_FIXTURES === '1'
    ? []
    : ['data/fixtureRepo.ts', 'data/ids.ts'].map((file) => path.resolve(__dirname, file));
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'pdf-lib') return { type: 'sourceFile', filePath: pdfLib };
  const resolved = upstream
    ? upstream(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
  if (resolved && resolved.type === 'sourceFile' && blocked.includes(path.resolve(resolved.filePath))) {
    return { type: 'sourceFile', filePath: stub };
  }
  return resolved;
};

module.exports = config;
