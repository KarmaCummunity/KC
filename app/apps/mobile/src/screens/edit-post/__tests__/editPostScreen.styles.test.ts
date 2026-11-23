// #2386 — edit-post styles stay on tokens with no leftover street / chip keys.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { countLiterals } from '../../../__tests__/brandGuardRules';

const STYLES_REL = 'src/screens/edit-post/editPostScreen.styles.ts';
const STYLES_ABS = path.join(__dirname, '..', 'editPostScreen.styles.ts');

/** Style keys the edit-post screen and form scroll content still reference. */
const USED_STYLE_KEYS = [
  'container',
  'center',
  'errorTitle',
  'retryBtn',
  'retryText',
  'header',
  'headerClose',
  'headerTitle',
  'saveBtn',
  'saveBtnText',
  'scroll',
  'scrollContent',
  'typeBadge',
  'typeBadgeGive',
  'typeBadgeRequest',
  'typeBadgeText',
  'typeBadgeSub',
  'charCount',
] as const;

/** Keys #2288 left behind when StreetAddressRow replaced the inline street row. */
const REMOVED_STREET_KEYS = ['streetRow', 'streetInputStreet', 'streetInputHouse'] as const;

function styleKeysInSource(source: string): string[] {
  return [...source.matchAll(/^\s{2}(\w+):\s*\{/gm)].map((match) => match[1]);
}

describe('editPostScreen.styles (#2386)', () => {
  const source = readFileSync(STYLES_ABS, 'utf8');

  it('has zero brand-guard findings (touched-file rule / D67)', () => {
    expect(countLiterals(source, STYLES_REL)).toEqual({});
  });

  it('drops the unused street address style keys', () => {
    for (const key of REMOVED_STREET_KEYS) {
      expect(source).not.toMatch(new RegExp(`\\b${key}\\s*:`));
    }
  });

  it('keeps only style keys the edit-post screen still uses', () => {
    expect(styleKeysInSource(source).sort()).toEqual([...USED_STYLE_KEYS].sort());
  });

  it('has no ad-hoc chip style object (kit Chip / FilterChipRow owns chips)', () => {
    expect(source).not.toMatch(/(?:^|[{,])\s*['"]?chip['"]?\s*:\s*\{/);
  });
});
