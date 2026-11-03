// ─────────────────────────────────────────────
// Typography — Karma Community
// Hebrew RTL — brand font Rubik (see `fonts.ts`, D66). `Text` / `TextInput`
// from @kc/ui resolve the weight-specific family, so presets only carry
// size, weight and line height.
// ─────────────────────────────────────────────

import { brandFontFamily } from './fonts';

/** Regular brand face, for the rare style that sets a family explicitly. */
export const fontFamily = brandFontFamily(400);

export const typography = {
  // Display
  h1: { fontSize: 28, fontWeight: '700' as const, lineHeight: 36 },
  h2: { fontSize: 22, fontWeight: '700' as const, lineHeight: 30 },
  h3: { fontSize: 18, fontWeight: '600' as const, lineHeight: 26 },
  h4: { fontSize: 16, fontWeight: '600' as const, lineHeight: 22 },

  // Body
  bodyLarge: { fontSize: 16, fontWeight: '400' as const, lineHeight: 24 },
  body: { fontSize: 14, fontWeight: '400' as const, lineHeight: 22 },
  bodySmall: { fontSize: 12, fontWeight: '400' as const, lineHeight: 18 },

  // Emphasis — weight modifiers spread over a size preset, one per loaded
  // brand face (see `fonts.ts`), so app code never writes a raw `fontWeight`.
  medium: { fontWeight: '500' as const },
  semiBold: { fontWeight: '600' as const },
  bold: { fontWeight: '700' as const },
  extraBold: { fontWeight: '800' as const },

  // UI
  button: { fontSize: 15, fontWeight: '600' as const, lineHeight: 22 },
  label: { fontSize: 12, fontWeight: '600' as const, lineHeight: 16 },
  caption: { fontSize: 11, fontWeight: '400' as const, lineHeight: 16 },
} as const;
