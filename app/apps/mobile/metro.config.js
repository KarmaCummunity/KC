const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');
const { redirectVectorIcons } = require('./metro/vectorIconsRedirect');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch monorepo packages while keeping Expo default watch roots.
const defaultWatch = config.watchFolders ?? [projectRoot];
config.watchFolders = [...new Set([...defaultWatch, workspaceRoot])];

// 2. Let Metro know where to resolve packages and in what order
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. With pnpm, allow hierarchical lookup so transitive deps remain resolvable.
config.resolver.disableHierarchicalLookup = false;

// 4. Web: zustand's ESM build uses import.meta; force CJS entry (see expo/expo#36384).
// 5. Exactly one react-native: pnpm can link workspace packages (e.g. @kc/ui) to a
//    second react-native copy, and two renderers in one bundle crash the first
//    native command ("property is not writable" on the first TextInput).
const appOrigin = path.join(projectRoot, 'package.json');
const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'zustand' || moduleName.startsWith('zustand/')) {
    return {
      type: 'sourceFile',
      filePath: require.resolve(moduleName, { paths: [projectRoot] }),
    };
  }
  const vectorIcons = redirectVectorIcons(moduleName, context.originModulePath, projectRoot);
  if (vectorIcons) return vectorIcons;
  const isReactNative = moduleName === 'react-native' || moduleName.startsWith('react-native/');
  const ctx = isReactNative ? { ...context, originModulePath: appOrigin } : context;
  if (upstreamResolve) {
    return upstreamResolve(ctx, moduleName, platform);
  }
  return ctx.resolveRequest(ctx, moduleName, platform);
};

module.exports = config;
