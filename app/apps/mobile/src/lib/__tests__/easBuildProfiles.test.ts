import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Ensures EAS profiles declare environment tier (#857). Supabase URL/key are injected via EAS secrets. */
describe('eas.json build profiles', () => {
  it('sets EXPO_PUBLIC_ENVIRONMENT on development, preview, and production', () => {
    const raw = readFileSync(join(__dirname, '../../../eas.json'), 'utf8');
    const eas = JSON.parse(raw) as {
      build: Record<string, { env?: Record<string, string> }>;
    };

    expect(eas.build.development?.env?.EXPO_PUBLIC_ENVIRONMENT).toBe('development');
    expect(eas.build.preview?.env?.EXPO_PUBLIC_ENVIRONMENT).toBe('development');
    expect(eas.build.production?.env?.EXPO_PUBLIC_ENVIRONMENT).toBe('production');
  });

  // D-195 Mobile nightly: TestFlight / Play internal tester builds use the dev backend,
  // so they must look like dev builds (banner, OTA channel, EAS env), never production.
  it('keeps the nightly store profile on dev settings with store build numbers', () => {
    const raw = readFileSync(join(__dirname, '../../../eas.json'), 'utf8');
    const eas = JSON.parse(raw) as {
      build: Record<
        string,
        {
          env?: Record<string, string>;
          channel?: string;
          environment?: string;
          autoIncrement?: boolean;
          distribution?: string;
        }
      >;
    };
    const nightly = eas.build.nightly;

    expect(nightly?.env?.EXPO_PUBLIC_ENVIRONMENT).toBe('development');
    expect(nightly?.channel).toBe('preview');
    expect(nightly?.environment).toBe('preview');
    expect(nightly?.autoIncrement).toBe(true);
    // Unset means "store", which TestFlight and Play internal submission need.
    expect(nightly?.distribution).toBeUndefined();
  });
});
