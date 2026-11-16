// NFR-PERF-005 — the Metro redirect that keeps the icon barrel (every family) out of the bundle.
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { redirectVectorIcons } = createRequire(import.meta.url)('../../metro/vectorIconsRedirect.js') as {
  redirectVectorIcons: (moduleName: string, origin: string, root: string) => { type: string; filePath: string } | null;
};

const ROOT = '/repo/app/apps/mobile';

describe('redirectVectorIcons', () => {
  it('points the barrel import of the app at the Ionicons-only module', () => {
    const hit = redirectVectorIcons('@expo/vector-icons', join(ROOT, 'src/components/TopBar.tsx'), ROOT);
    expect(hit).toEqual({ type: 'sourceFile', filePath: join(ROOT, 'src/lib/icons/ioniconsOnly.ts') });
  });

  it('leaves a library inside node_modules on the real package', () => {
    expect(redirectVectorIcons('@expo/vector-icons', join(ROOT, 'node_modules/some-lib/index.js'), ROOT)).toBeNull();
  });

  it('leaves the family subpaths and every other module alone', () => {
    const from = join(ROOT, 'src/components/TopBar.tsx');
    expect(redirectVectorIcons('@expo/vector-icons/Ionicons', from, ROOT)).toBeNull();
    expect(redirectVectorIcons('react', from, ROOT)).toBeNull();
  });
});
