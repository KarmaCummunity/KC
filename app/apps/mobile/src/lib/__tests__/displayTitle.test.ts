import { describe, expect, it } from 'vitest';
import { cleanDisplayTitle, isTestListingTitle } from '../displayTitle';

describe('cleanDisplayTitle', () => {
  it('strips [DEMO] prefixes', () => {
    expect(cleanDisplayTitle('[DEMO] מחפש/ת טרמפ ללוד')).toBe('מחפש/ת טרמפ ללוד');
    expect(cleanDisplayTitle('[demo][TEST] x')).toBe('x');
  });
  it('keeps normal titles', () => {
    expect(cleanDisplayTitle('ספה [DEMO]')).toBe('ספה [DEMO]');
    expect(cleanDisplayTitle(null)).toBe('');
  });
});

describe('isTestListingTitle (regression: raw "[e2e] 2026-10-29T06:41..." in similar posts)', () => {
  it('flags e2e-prefixed titles', () => {
    expect(isTestListingTitle('[e2e] 2026-10-29T06:41:12.345Z')).toBe(true);
    expect(isTestListingTitle('  [E2E] something')).toBe(true);
  });
  it('flags titles carrying a raw ISO timestamp', () => {
    expect(isTestListingTitle('listing 2026-10-29T06:41')).toBe(true);
    expect(isTestListingTitle('x 2026-10-29T06:41:00+03:00')).toBe(true);
  });
  it('keeps real titles, including plain dates', () => {
    expect(isTestListingTitle('מחפש/ת: לגו מעורב')).toBe(false);
    expect(isTestListingTitle('טרמפ ב-2026-10-29')).toBe(false);
    expect(isTestListingTitle(null)).toBe(false);
    expect(isTestListingTitle('')).toBe(false);
  });
  it('cleanDisplayTitle also strips the [e2e] prefix', () => {
    expect(cleanDisplayTitle('[e2e] ספה')).toBe('ספה');
  });
});
