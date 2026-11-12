import { describe, expect, it } from 'vitest';
import { isValidOrgSlug, suggestOrgSlug } from '../orgSlug';

describe('isValidOrgSlug', () => {
  it('accepts lowercase hyphen-joined Latin words and digits', () => {
    expect(isValidOrgSlug('aid-for-all-2')).toBe(true);
    expect(isValidOrgSlug('aid')).toBe(true);
  });

  it('refuses capitals, spaces, edge hyphens, empty and over-long addresses', () => {
    for (const slug of ['Aid', 'aid for', '-aid', 'aid-', 'aid--all', '', 'a'.repeat(61), 'a-b-c-d-e-f-g-h-i-j-k']) {
      expect(isValidOrgSlug(slug)).toBe(false);
    }
  });
});

describe('suggestOrgSlug', () => {
  it('takes the Latin words of the name', () => {
    expect(suggestOrgSlug('Aid For All, Ltd.', null)).toBe('aid-for-all-ltd');
  });

  it('falls back to the website host name, then to nothing', () => {
    expect(suggestOrgSlug('עמותה', 'https://www.Meshulash.org/about')).toBe('meshulash');
    expect(suggestOrgSlug('עמותה', null)).toBe('');
  });

  it('always suggests a valid address or nothing', () => {
    const long = suggestOrgSlug(`${'word '.repeat(20)}`, null);
    expect(isValidOrgSlug(long)).toBe(true);
  });
});
