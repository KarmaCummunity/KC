// app/apps/mobile/src/lib/__tests__/expoModulesAutolinking.test.ts
//
// KC#1276 — every native Expo module the app depends on must be autolinkable by the
// installed SDK. SDK 54 autolinking requires `android.publication.version` when a module
// declares a publication; an SDK 55 module without it (expo-navigation-bar 58.x) made
// Gradle fail while evaluating settings.gradle, so no Android build could run.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MOBILE_ROOT = join(__dirname, '..', '..', '..');
const pkg = JSON.parse(readFileSync(join(MOBILE_ROOT, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
};

type ModuleConfig = { android?: { publication?: { version?: string } } };

/** Direct dependencies that ship an `expo-module.config.json`, with their parsed config. */
function expoModules(): Array<{ name: string; config: ModuleConfig }> {
  return Object.keys(pkg.dependencies).flatMap((name) => {
    const file = join(MOBILE_ROOT, 'node_modules', name, 'expo-module.config.json');
    return existsSync(file) ? [{ name, config: JSON.parse(readFileSync(file, 'utf8')) as ModuleConfig }] : [];
  });
}

describe('native Expo modules', () => {
  it('finds the installed Expo modules', () => {
    expect(expoModules().length).toBeGreaterThan(5);
  });

  it('declare a version on every Android publication (SDK 54 autolinking contract)', () => {
    const broken = expoModules()
      .filter(({ config }) => config.android?.publication && !config.android.publication.version)
      .map(({ name }) => name);
    expect(broken).toEqual([]);
  });

  it('pins expo-navigation-bar to the SDK 54 line', () => {
    expect(pkg.dependencies['expo-navigation-bar']).toMatch(/^~5\./);
  });
});
