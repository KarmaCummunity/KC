import { describe, it, expect, vi } from 'vitest';

// Echo i18n: a key resolves to itself unless it is missing from `known`, in
// which case the caller's defaultValue is returned (as i18next does).
const known = new Set(['errors.post.too_many_media_assets', 'errors.auth.invalid_credentials']);
vi.mock('../../i18n', () => ({
  default: {
    t: (key: string, opts?: { defaultValue?: string; max?: number }) => {
      if (!known.has(key)) return opts?.defaultValue ?? `[fallback:${key}]`;
      return opts?.max === undefined ? key : `${key}:${opts.max}`;
    },
  },
}));

import { mapPostErrorToHebrew } from '../postMessages';
import { mapAuthErrorToHebrew } from '../authMessages';

describe('mapPostErrorToHebrew', () => {
  it('interpolates the domain media limit', () => {
    expect(mapPostErrorToHebrew('too_many_media_assets')).toBe('errors.post.too_many_media_assets:5');
  });

  it('falls back to the unknown-error copy for an unmapped code', () => {
    expect(mapPostErrorToHebrew('not_a_real_code' as never)).toBe('[fallback:errors.post.unknown]');
  });
});

describe('mapAuthErrorToHebrew', () => {
  it('maps a known code to its key', () => {
    expect(mapAuthErrorToHebrew('invalid_credentials')).toBe('errors.auth.invalid_credentials');
  });

  it('falls back to the unknown-error copy for an unmapped code', () => {
    expect(mapAuthErrorToHebrew('not_a_real_code' as never)).toBe('[fallback:errors.auth.unknown]');
  });
});
