import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isStoreBuild, shouldShowDevBanner } from '../../config/environment';

// The red DEV strip must never reach App Review or store users, even on the
// kc-dev `nightly` TestFlight / Play build (EXPO_PUBLIC_ENVIRONMENT=development).
const ORIGINAL = process.env['EXPO_PUBLIC_STORE_BUILD'];

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env['EXPO_PUBLIC_STORE_BUILD'];
  else process.env['EXPO_PUBLIC_STORE_BUILD'] = ORIGINAL;
});

describe('shouldShowDevBanner', () => {
  it('never shows in a store build, even with a dev env or a Metro bundle', () => {
    expect(shouldShowDevBanner({ envDev: true, metroDev: false, storeBuild: true })).toBe(false);
    expect(shouldShowDevBanner({ envDev: true, metroDev: true, storeBuild: true })).toBe(false);
    expect(shouldShowDevBanner({ envDev: false, metroDev: true, storeBuild: true })).toBe(false);
  });

  it('shows outside the stores only for an explicit dev env or a Metro dev bundle', () => {
    expect(shouldShowDevBanner({ envDev: true, metroDev: false, storeBuild: false })).toBe(true);
    expect(shouldShowDevBanner({ envDev: false, metroDev: true, storeBuild: false })).toBe(true);
    expect(shouldShowDevBanner({ envDev: false, metroDev: false, storeBuild: false })).toBe(false);
  });
});

describe('isStoreBuild', () => {
  it('is true only for the exact string "true"', () => {
    process.env['EXPO_PUBLIC_STORE_BUILD'] = 'true';
    expect(isStoreBuild()).toBe(true);
    for (const v of ['1', 'TRUE', 'yes', '']) {
      process.env['EXPO_PUBLIC_STORE_BUILD'] = v;
      expect(isStoreBuild()).toBe(false);
    }
    delete process.env['EXPO_PUBLIC_STORE_BUILD'];
    expect(isStoreBuild()).toBe(false);
  });
});

describe('eas.json store profiles', () => {
  const eas = JSON.parse(readFileSync(join(__dirname, '../../../eas.json'), 'utf8')) as {
    build: Record<string, { env?: Record<string, string>; distribution?: string }>;
  };

  it('marks every store-track profile as a store build', () => {
    // A profile without distribution "internal" is a store profile (TestFlight / Play).
    const storeProfiles = Object.entries(eas.build).filter(([, p]) => p.distribution !== 'internal');
    expect(storeProfiles.map(([name]) => name).sort()).toEqual(['nightly', 'production']);
    for (const [, p] of storeProfiles) expect(p.env?.EXPO_PUBLIC_STORE_BUILD).toBe('true');
  });

  it('leaves the internal development and preview builds unmarked (banner stays)', () => {
    expect(eas.build.development?.env?.EXPO_PUBLIC_STORE_BUILD).toBeUndefined();
    expect(eas.build.preview?.env?.EXPO_PUBLIC_STORE_BUILD).toBeUndefined();
  });
});
