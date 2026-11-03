import { describe, it, expect } from 'vitest';
import { brand, buildDesignTokens, darkColors, lightColors } from '../index';

// Brand token contract — spec 17 §6 (D65).
const COLOR_VALUE = /^(#[0-9A-F]{6}|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (0|1|0?\.\d+)\))$/i;

describe('brand identity', () => {
  it('names the product Karma Community, nicknamed KC', () => {
    expect(brand.name).toBe('Karma Community');
    expect(brand.shortName).toBe('KC');
  });
});

describe('palette parity', () => {
  it('keeps light and dark palettes on the same token set', () => {
    expect(Object.keys(darkColors).sort()).toEqual(Object.keys(lightColors).sort());
  });

  it('uses only #RRGGBB or rgba() values, so design tools can import them', () => {
    const invalid = [...Object.entries(lightColors), ...Object.entries(darkColors)].filter(
      ([, value]) => !COLOR_VALUE.test(value),
    );
    expect(invalid).toEqual([]);
  });
});

describe('design-token export', () => {
  it('exports every palette token for both colour modes', () => {
    const tokens = buildDesignTokens();
    expect(Object.keys(tokens.color.light)).toEqual(Object.keys(lightColors));
    expect(tokens.color.dark.primary).toEqual({ $type: 'color', $value: darkColors.primary });
  });

  it('exports text styles only for presets that carry a font size', () => {
    const { typography } = buildDesignTokens();
    expect(typography).toHaveProperty('h1');
    expect(typography).not.toHaveProperty('bold');
    expect(typography.body.$value).toMatchObject({ fontSize: '14px', fontWeight: 400, lineHeight: '22px' });
  });

  it('matches the committed kc.tokens.json (regenerate with `pnpm --filter @kc/ui test -- -u`)', async () => {
    const json = `${JSON.stringify(buildDesignTokens(), null, 2)}\n`;
    await expect(json).toMatchFileSnapshot('../../tokens/kc.tokens.json');
  });
});
