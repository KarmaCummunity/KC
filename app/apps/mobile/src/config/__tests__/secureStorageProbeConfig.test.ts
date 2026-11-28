import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigContext } from 'expo/config';
import expoAppConfig from '../../../app.config';
const build = () => expoAppConfig({ config: { name: 'KC', slug: 'kc' } } as ConfigContext).extra?.secureStorageProbeEnabled;
afterEach(() => vi.unstubAllEnvs());
describe('secure-storage probe build boundary (#856)', () => {
  it('defaults off and requires all dedicated DEV test switches', () => {
    vi.stubEnv('KC_E2E_BUILD', ''); vi.stubEnv('KC_SECURE_STORAGE_PROBE', '');
    vi.stubEnv('EXPO_PUBLIC_ENVIRONMENT', 'development'); vi.stubEnv('EXPO_PUBLIC_STORE_BUILD', '');
    expect(build()).toBe(false);
    vi.stubEnv('KC_E2E_BUILD', '1'); expect(build()).toBe(false);
    vi.stubEnv('KC_SECURE_STORAGE_PROBE', '1'); expect(build()).toBe(true);
    vi.stubEnv('EXPO_PUBLIC_ENVIRONMENT', 'production'); expect(build()).toBe(false);
  });
  it('never opts a store binary in, even with the test switches', () => {
    vi.stubEnv('KC_E2E_BUILD', '1'); vi.stubEnv('KC_SECURE_STORAGE_PROBE', '1');
    vi.stubEnv('EXPO_PUBLIC_ENVIRONMENT', 'development'); vi.stubEnv('EXPO_PUBLIC_STORE_BUILD', 'true');
    expect(build()).toBe(false);
  });
});
