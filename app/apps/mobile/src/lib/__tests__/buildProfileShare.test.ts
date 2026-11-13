import { describe, expect, it } from 'vitest';
import type { ShareTranslate } from '../buildPostShareMessage';
import { buildProfileShareMessage, buildProfileShareUrl } from '../buildProfileShare';

const t: ShareTranslate = (key, params) => `t:${key}${params ? `:${JSON.stringify(params)}` : ''}`;

describe('buildProfileShareUrl', () => {
  it('builds the canonical /user/<handle> link on the web base URL', () => {
    expect(buildProfileShareUrl('dana.k', 'https://karma-community-kc.com')).toBe('https://karma-community-kc.com/user/dana.k');
  });

  it('trims the handle and encodes unsafe characters', () => {
    expect(buildProfileShareUrl(' a b/c ', 'https://x.test')).toBe('https://x.test/user/a%20b%2Fc');
  });

  it('refuses a blank handle', () => {
    expect(() => buildProfileShareUrl('  ', 'https://x.test')).toThrow('shareHandle is required');
  });
});

describe('buildProfileShareMessage', () => {
  it('names the profile when a display name is visible', () => {
    const msg = buildProfileShareMessage({ displayName: ' דנה ' }, t);
    expect(msg.split('\n')[0]).toBe('t:share.profile.headline:{"name":"דנה"}');
    expect(msg.endsWith('t:share.profile.cta')).toBe(true);
  });

  it('uses the anonymous headline when the profile hides its name', () => {
    for (const displayName of [null, '', '  ']) {
      expect(buildProfileShareMessage({ displayName }, t).split('\n')[0]).toBe('t:share.profile.headlineAnonymous');
    }
  });
});
