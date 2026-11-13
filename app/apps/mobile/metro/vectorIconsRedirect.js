// NFR-PERF-005 — keeps the app's `import { Ionicons } from '@expo/vector-icons'` from bundling every
// icon family. `@expo/vector-icons` is a barrel: Metro follows all of its lazy `require`s, so the web
// and native bundles carried about 0.6 MB of glyph maps for families the app never renders. The app
// imports Ionicons only, so its own sources are pointed at a module that re-exports just that family.
//
// Only imports made by the app's own code are redirected: a dependency inside node_modules keeps the
// real package, so a library that needs another family still works.
const path = require('node:path');

const BARREL = '@expo/vector-icons';

/**
 * The resolution to use for `moduleName` imported from `originModulePath`, or null when the import is
 * not the barrel import of the app's own code.
 */
function redirectVectorIcons(moduleName, originModulePath, projectRoot) {
  if (moduleName !== BARREL) return null;
  if (!originModulePath || originModulePath.includes(`${path.sep}node_modules${path.sep}`)) return null;
  return { type: 'sourceFile', filePath: path.join(projectRoot, 'src', 'lib', 'icons', 'ioniconsOnly.ts') };
}

module.exports = { redirectVectorIcons };
