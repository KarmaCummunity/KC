import { describe, it, expect } from 'vitest';
import { isPublicOrgPagePath } from '../publicOrgPaths';

describe('isPublicOrgPagePath (FR-ORG-001 AC4)', () => {
  it('opens a nonprofit page to signed-out visitors', () => {
    expect(isPublicOrgPagePath('/donations/money/nonprofit/aid')).toBe(true);
    expect(isPublicOrgPagePath('/donations/money/nonprofit/aid/')).toBe(true);
  });

  it('keeps donating, the money hub and everything else behind sign-in', () => {
    expect(isPublicOrgPagePath('/donations/money')).toBe(false);
    expect(isPublicOrgPagePath('/donations/money/nonprofit/aid/donate')).toBe(false);
    expect(isPublicOrgPagePath('/donations/money/standing-order/x')).toBe(false);
    expect(isPublicOrgPagePath('/settings')).toBe(false);
  });
});
