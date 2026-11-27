import { describe, expect, it } from 'vitest';
import { guestAuthorPath } from '../guestAuthorPath';

describe('guestAuthorPath', () => {
  it('builds the guest profile route for a public handle', () => {
    expect(guestAuthorPath('alice')).toBe('/browse/user/alice');
    expect(guestAuthorPath('  @Alice ')).toBe('/browse/user/Alice');
    expect(guestAuthorPath('a/b')).toBe('/browse/user/a%2Fb');
  });

  it('returns null when there is no tappable author (no dead end)', () => {
    expect(guestAuthorPath(null)).toBeNull();
    expect(guestAuthorPath(undefined)).toBeNull();
    expect(guestAuthorPath('')).toBeNull();
    expect(guestAuthorPath('   ')).toBeNull();
    expect(guestAuthorPath('@@@')).toBeNull();
  });
});
