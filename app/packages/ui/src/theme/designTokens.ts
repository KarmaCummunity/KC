// ─────────────────────────────────────────────
// Design-token export — W3C design-tokens (DTCG) format (spec 17 §3)
// ─────────────────────────────────────────────
//
// Builds the JSON that Figma variables and the Claude Design project are
// refreshed from. `packages/ui/tokens/kc.tokens.json` is a generated file
// guarded by a vitest file snapshot — edit the theme files, never the JSON.

import { brand } from './brand';
import { BREAKPOINTS } from './breakpoints';
import { darkColors, lightColors, type ColorPalette } from './colors';
import { brandFont } from './fonts';
import { iconSize } from './iconSize';
import { radius, shadow, spacing } from './spacing';
import { typography } from './typography';
import { zIndex } from './zIndex';

// Design tools know the family by its public name, not the per-weight face names.
const FONT_STACK = [brandFont.name, 'system-ui'] as const;

type Token<TType extends string, TValue> = { $type: TType; $value: TValue };

const px = (value: number): string => `${value}px`;

function colorGroup(palette: ColorPalette): Record<string, Token<'color', string>> {
  return Object.fromEntries(
    Object.entries(palette).map(([name, value]) => [name, { $type: 'color' as const, $value: value }]),
  );
}

function dimensionGroup(scale: Record<string, number>): Record<string, Token<'dimension', string>> {
  return Object.fromEntries(
    Object.entries(scale).map(([name, value]) => [name, { $type: 'dimension' as const, $value: px(value) }]),
  );
}

function typographyGroup() {
  return Object.fromEntries(
    Object.entries(typography)
      // `semiBold` / `bold` are weight modifiers, not standalone text styles.
      .filter(([, style]) => 'fontSize' in style)
      .map(([name, style]) => {
        const textStyle = style as { fontSize: number; fontWeight: string; lineHeight: number };
        return [
          name,
          {
            $type: 'typography' as const,
            $value: {
              fontFamily: [...FONT_STACK],
              fontSize: px(textStyle.fontSize),
              fontWeight: Number(textStyle.fontWeight),
              lineHeight: px(textStyle.lineHeight),
            },
          },
        ];
      }),
  );
}

/** `#RGB` / `#RRGGBB` shadow colour at `opacity`, as the CSS `rgba()` design tools read. */
function shadowRgba(hex: string, opacity: number): string {
  const digits = hex.slice(1);
  // Expand the short form (`#000` → `000000`) so every colour parses the same way.
  const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join('') : digits;
  const [r, g, b] = [0, 2, 4].map((offset) => Number.parseInt(full.slice(offset, offset + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function shadowGroup() {
  return Object.fromEntries(
    Object.entries(shadow).map(([name, preset]) => [
      name,
      {
        $type: 'shadow' as const,
        $value: {
          color: shadowRgba(preset.shadowColor, preset.shadowOpacity),
          offsetX: px(preset.shadowOffset.width),
          offsetY: px(preset.shadowOffset.height),
          blur: px(preset.shadowRadius),
          spread: px(0),
        },
      },
    ]),
  );
}

export function buildDesignTokens() {
  return {
    $description: `${brand.name} (${brand.shortName}) design tokens — generated from packages/ui/src/theme; do not edit by hand.`,
    color: {
      light: colorGroup(lightColors),
      dark: colorGroup(darkColors),
    },
    spacing: dimensionGroup(spacing),
    radius: dimensionGroup(radius),
    iconSize: dimensionGroup(iconSize),
    // Layers are unitless stacking orders, not dimensions.
    zIndex: Object.fromEntries(
      Object.entries(zIndex).map(([name, value]) => [name, { $type: 'number' as const, $value: value }]),
    ),
    breakpoint: dimensionGroup(BREAKPOINTS),
    typography: typographyGroup(),
    shadow: shadowGroup(),
  };
}
