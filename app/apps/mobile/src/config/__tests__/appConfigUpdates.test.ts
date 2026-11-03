// OTA updates (audit P1-6): EAS Update channels in eas.json only work when the
// app config points expo-updates at this EAS project. The URL must follow the
// resolved project id, which CI may inject through EAS_PROJECT_ID.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExpoConfig } from 'expo/config';
import expoAppConfig from '../../../app.config';
import appJson from '../../../app.json';

const base = appJson.expo as unknown as ExpoConfig;
const resolve = () => expoAppConfig({ config: base } as Parameters<typeof expoAppConfig>[0]);

describe('expo-updates config', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('points updates at the app.json EAS project and keeps the appVersion runtime policy', () => {
    vi.stubEnv('EAS_PROJECT_ID', '');
    const config = resolve();
    expect(config.updates?.url).toBe(`https://u.expo.dev/${base.extra?.eas?.projectId}`);
    expect(config.runtimeVersion).toEqual({ policy: 'appVersion' });
  });

  it('follows a project id injected by CI', () => {
    vi.stubEnv('EAS_PROJECT_ID', 'ci-project-id');
    expect(resolve().updates?.url).toBe('https://u.expo.dev/ci-project-id');
  });
});
