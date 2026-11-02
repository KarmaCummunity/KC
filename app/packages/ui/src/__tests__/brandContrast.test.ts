import { describe, it, expect } from 'vitest';
import { avatarPalette, contrastRatio, darkColors, lightColors, relativeLuminance } from '../index';
import type { ColorPalette, ColorToken } from '../index';

// Brand contrast floor — spec 17 §5 (D65), WCAG 2.x AA / IS 5568.
const AA_TEXT = 4.5;
const AA_LARGE_TEXT_OR_UI = 3;

interface RequiredPair {
  foreground: ColorToken;
  background: ColorToken;
  minimum: number;
  usage: string;
}

const REQUIRED_PAIRS: readonly RequiredPair[] = [
  { foreground: 'textPrimary', background: 'background', minimum: AA_TEXT, usage: 'body text on the backdrop' },
  { foreground: 'textPrimary', background: 'surface', minimum: AA_TEXT, usage: 'body text on cards' },
  { foreground: 'textSecondary', background: 'background', minimum: AA_TEXT, usage: 'secondary text on the backdrop' },
  { foreground: 'textSecondary', background: 'surface', minimum: AA_TEXT, usage: 'secondary text on cards' },
  { foreground: 'textInverse', background: 'primary', minimum: AA_TEXT, usage: 'primary button label' },
  { foreground: 'textInverse', background: 'error', minimum: AA_TEXT, usage: 'danger button label' },
  { foreground: 'primary', background: 'surface', minimum: AA_LARGE_TEXT_OR_UI, usage: 'brand icons and links on cards' },
  { foreground: 'primary', background: 'background', minimum: AA_LARGE_TEXT_OR_UI, usage: 'brand icons and links on the backdrop' },
  { foreground: 'tabActive', background: 'surface', minimum: AA_LARGE_TEXT_OR_UI, usage: 'active tab glyph' },
  { foreground: 'tabInactive', background: 'surface', minimum: AA_LARGE_TEXT_OR_UI, usage: 'inactive tab glyph' },
  { foreground: 'giveTag', background: 'giveTagBg', minimum: AA_TEXT, usage: 'give post-type tag label' },
  { foreground: 'requestTag', background: 'requestTagBg', minimum: AA_TEXT, usage: 'request post-type tag label' },
  { foreground: 'error', background: 'surface', minimum: AA_TEXT, usage: 'inline error message' },
  { foreground: 'secondary', background: 'surface', minimum: AA_LARGE_TEXT_OR_UI, usage: 'secondary accent glyphs' },
  { foreground: 'roleSuperAdmin', background: 'surface', minimum: AA_LARGE_TEXT_OR_UI, usage: 'super_admin role badge dot and border' },
  { foreground: 'roleModerator', background: 'surface', minimum: AA_LARGE_TEXT_OR_UI, usage: 'moderator role badge dot and border' },
  { foreground: 'roleSupport', background: 'surface', minimum: AA_LARGE_TEXT_OR_UI, usage: 'support role badge dot and border' },
  { foreground: 'roleOperator', background: 'surface', minimum: AA_LARGE_TEXT_OR_UI, usage: 'operator role badge dot and border' },
  { foreground: 'roleOperatorsManager', background: 'surface', minimum: AA_LARGE_TEXT_OR_UI, usage: 'operators_manager role badge dot and border' },
  { foreground: 'roleOrgAdmin', background: 'surface', minimum: AA_LARGE_TEXT_OR_UI, usage: 'org_admin role badge dot and border' },
  { foreground: 'roleOrgManager', background: 'surface', minimum: AA_LARGE_TEXT_OR_UI, usage: 'org_manager role badge dot and border' },
  { foreground: 'roleOrgEmployee', background: 'surface', minimum: AA_LARGE_TEXT_OR_UI, usage: 'org_employee role badge dot and border' },
  { foreground: 'roleVolunteerManager', background: 'surface', minimum: AA_LARGE_TEXT_OR_UI, usage: 'volunteer_manager role badge dot and border' },
  { foreground: 'roleOrgVolunteer', background: 'surface', minimum: AA_LARGE_TEXT_OR_UI, usage: 'org_volunteer role badge dot and border' },
];

// Pairs that fail today. Each entry must keep failing — once it passes, the
// test flags it as stale so the exception is deleted with the fix.
// Empty since D66: every required pair meets AA in both palettes.
const KNOWN_EXCEPTIONS: Readonly<Record<string, string>> = {};

const PALETTES: ReadonlyArray<readonly [string, ColorPalette]> = [
  ['light', lightColors],
  ['dark', darkColors],
];

describe('theme/contrast', () => {
  it('rates black on white at the WCAG maximum of 21:1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  });

  it('rates a colour against itself at 1:1 regardless of order', () => {
    expect(contrastRatio('#F97316', '#F97316')).toBe(1);
    expect(contrastRatio('#FFFFFF', '#111827')).toBe(contrastRatio('#111827', '#FFFFFF'));
  });

  it('rejects colours it cannot rate (alpha, shorthand, named)', () => {
    expect(() => relativeLuminance('rgba(0, 0, 0, 0.5)')).toThrow(RangeError);
    expect(() => relativeLuminance('#FFF')).toThrow(RangeError);
    expect(() => relativeLuminance('orange')).toThrow(RangeError);
  });
});

describe('brand contrast floor (WCAG AA)', () => {
  for (const [mode, palette] of PALETTES) {
    for (const pair of REQUIRED_PAIRS) {
      const key = `${mode}:${pair.foreground}/${pair.background}`;
      const exception = KNOWN_EXCEPTIONS[key];
      const ratio = contrastRatio(palette[pair.foreground], palette[pair.background]);

      if (exception) {
        it(`${key} is still below ${pair.minimum}:1 (${exception}) — delete the exception once fixed`, () => {
          expect(ratio).toBeLessThan(pair.minimum);
        });
      } else {
        it(`${key} meets ${pair.minimum}:1 for ${pair.usage}`, () => {
          expect(ratio).toBeGreaterThanOrEqual(pair.minimum);
        });
      }
    }
  }

  it('lists exceptions only for pairs that are actually checked', () => {
    const checked = new Set(
      PALETTES.flatMap(([mode]) => REQUIRED_PAIRS.map((pair) => `${mode}:${pair.foreground}/${pair.background}`)),
    );
    expect(Object.keys(KNOWN_EXCEPTIONS).filter((key) => !checked.has(key))).toEqual([]);
  });
});

describe('initials-avatar palette', () => {
  for (const background of avatarPalette.backgrounds) {
    it(`${avatarPalette.foreground} initials on ${background} meet ${AA_TEXT}:1`, () => {
      expect(contrastRatio(avatarPalette.foreground, background)).toBeGreaterThanOrEqual(AA_TEXT);
    });
  }
});
