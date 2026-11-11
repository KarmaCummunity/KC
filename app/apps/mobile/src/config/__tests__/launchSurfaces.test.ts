// Mapped to spec: first-launch scope (Nave, 2026-11-11) — email auth, WhatsApp bot and payments are
// hidden in production, visible in development; app_flags and EXPO_PUBLIC_LAUNCH_* can override.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LAUNCH_SURFACES,
  LAUNCH_SURFACE_REMOTE_KEYS,
  launchSurfaceDefault,
  parseLaunchSwitch,
  resolveLaunchSurface,
} from '../launchSurfaces';

const VARS = [
  'EXPO_PUBLIC_ENVIRONMENT',
  'EXPO_PUBLIC_LAUNCH_EMAIL_AUTH',
  'EXPO_PUBLIC_LAUNCH_WHATSAPP_BOT',
  'EXPO_PUBLIC_LAUNCH_PAYMENTS',
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const v of VARS) {
    saved[v] = process.env[v];
    delete process.env[v];
  }
});
afterEach(() => {
  for (const v of VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
});

describe('parseLaunchSwitch', () => {
  it('reads on/off spellings, trimmed and case-insensitive', () => {
    for (const on of ['1', 'true', 'TRUE', ' on ']) expect(parseLaunchSwitch(on)).toBe(true);
    for (const off of ['0', 'false', 'False', 'off']) expect(parseLaunchSwitch(off)).toBe(false);
  });
  it('treats unset, empty and unknown values as no override', () => {
    for (const none of [undefined, '', '   ', 'yes', '2']) expect(parseLaunchSwitch(none)).toBeUndefined();
  });
});

describe('environment default', () => {
  it('is on in a development build', () => {
    process.env['EXPO_PUBLIC_ENVIRONMENT'] = 'development';
    expect(launchSurfaceDefault()).toBe(true);
    for (const s of LAUNCH_SURFACES) expect(resolveLaunchSurface(s)).toBe(true);
  });
  it('is off in production, and when the environment is unset or unknown (fail-safe)', () => {
    for (const env of ['production', undefined, 'staging']) {
      if (env === undefined) delete process.env['EXPO_PUBLIC_ENVIRONMENT'];
      else process.env['EXPO_PUBLIC_ENVIRONMENT'] = env;
      for (const s of LAUNCH_SURFACES) expect(resolveLaunchSurface(s)).toBe(false);
    }
  });
});

describe('build-time override', () => {
  it('turns a surface on in production and off in development, per surface', () => {
    process.env['EXPO_PUBLIC_ENVIRONMENT'] = 'production';
    process.env['EXPO_PUBLIC_LAUNCH_EMAIL_AUTH'] = 'true';
    expect(resolveLaunchSurface('emailAuth')).toBe(true);
    expect(resolveLaunchSurface('whatsappBot')).toBe(false);
    expect(resolveLaunchSurface('payments')).toBe(false);

    process.env['EXPO_PUBLIC_ENVIRONMENT'] = 'development';
    process.env['EXPO_PUBLIC_LAUNCH_WHATSAPP_BOT'] = '0';
    process.env['EXPO_PUBLIC_LAUNCH_PAYMENTS'] = 'off';
    expect(resolveLaunchSurface('whatsappBot')).toBe(false);
    expect(resolveLaunchSurface('payments')).toBe(false);
    expect(resolveLaunchSurface('emailAuth')).toBe(true);
  });
  it('ignores an unparsable override', () => {
    process.env['EXPO_PUBLIC_ENVIRONMENT'] = 'production';
    process.env['EXPO_PUBLIC_LAUNCH_EMAIL_AUTH'] = 'maybe';
    expect(resolveLaunchSurface('emailAuth')).toBe(false);
  });
});

describe('remote app_flags override', () => {
  it('wins over the build override and the default, both ways', () => {
    process.env['EXPO_PUBLIC_ENVIRONMENT'] = 'production';
    process.env['EXPO_PUBLIC_LAUNCH_EMAIL_AUTH'] = 'false';
    expect(resolveLaunchSurface('emailAuth', { launch_email_auth_enabled: true })).toBe(true);

    process.env['EXPO_PUBLIC_ENVIRONMENT'] = 'development';
    process.env['EXPO_PUBLIC_LAUNCH_EMAIL_AUTH'] = 'true';
    expect(resolveLaunchSurface('emailAuth', { launch_email_auth_enabled: false })).toBe(false);
  });
  it('falls through when the row is absent or not a boolean', () => {
    process.env['EXPO_PUBLIC_ENVIRONMENT'] = 'production';
    expect(resolveLaunchSurface('payments', {})).toBe(false);
    expect(resolveLaunchSurface('payments', { launch_payments_enabled: undefined })).toBe(false);
    expect(resolveLaunchSurface('payments', { launch_payments_enabled: 'true' as unknown as boolean })).toBe(false);
  });
  it('uses one distinct app_flags key per surface', () => {
    const keys = Object.values(LAUNCH_SURFACE_REMOTE_KEYS);
    expect(new Set(keys).size).toBe(LAUNCH_SURFACES.length);
    expect(resolveLaunchSurface('whatsappBot', { launch_whatsapp_bot_enabled: true })).toBe(true);
    expect(resolveLaunchSurface('whatsappBot', { launch_email_auth_enabled: true })).toBe(false);
  });
});
