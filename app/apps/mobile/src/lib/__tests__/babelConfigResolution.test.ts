// app/apps/mobile/src/lib/__tests__/babelConfigResolution.test.ts
//
// KC#1276 — Babel resolves the presets and plugins named in babel.config.js from the app
// directory. With pnpm's isolated node_modules a package is only linked there if the app
// declares it; `babel-preset-expo` came in transitively through `expo`, so the Android
// release bundle (Gradle → Metro) failed with "Cannot find module 'babel-preset-expo'".
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const MOBILE_ROOT = join(__dirname, '..', '..', '..');
const requireFromApp = createRequire(join(MOBILE_ROOT, 'package.json'));

type BabelEntry = string | [string, unknown];
const config = (requireFromApp('./babel.config.js') as (api: { cache: (v: boolean) => void }) => {
  presets?: BabelEntry[];
  plugins?: BabelEntry[];
})({ cache: () => undefined });

const names = [...(config.presets ?? []), ...(config.plugins ?? [])].map((e) => (Array.isArray(e) ? e[0] : e));

describe('babel.config.js', () => {
  it('names at least the Expo preset', () => {
    expect(names).toContain('babel-preset-expo');
  });

  it.each(names)('resolves %s from the app directory', (name) => {
    expect(() => requireFromApp.resolve(name)).not.toThrow();
  });
});
