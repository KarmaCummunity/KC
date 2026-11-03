// ─────────────────────────────────────────────
// Brand font — Karma Community (spec 17 §4, D66)
// ─────────────────────────────────────────────
//
// One place to swap the brand font: change `brandFont` here and the matching
// loader map in `apps/mobile/src/lib/useBrandFonts.ts`. Custom fonts carry one
// family name per weight, so components resolve the family from `fontWeight`
// instead of asking the platform to synthesise bold.

export const brandFont = {
  name: 'Rubik',
  faces: {
    400: 'Rubik_400Regular',
    500: 'Rubik_500Medium',
    600: 'Rubik_600SemiBold',
    700: 'Rubik_700Bold',
    800: 'Rubik_800ExtraBold',
  },
} as const;

export type BrandFontWeight = keyof typeof brandFont.faces;

const LOADED_WEIGHTS = Object.keys(brandFont.faces).map(Number) as BrandFontWeight[];

function toNumericWeight(fontWeight: string | number | undefined): number {
  if (fontWeight === undefined || fontWeight === 'normal') return 400;
  if (fontWeight === 'bold') return 700;
  const numeric = Number(fontWeight);
  return Number.isFinite(numeric) ? numeric : 400;
}

/** Brand font family for a React Native `fontWeight`, snapped to the nearest loaded face. */
export function brandFontFamily(fontWeight?: string | number): string {
  const wanted = toNumericWeight(fontWeight);
  const nearest = LOADED_WEIGHTS.reduce(
    (best, weight) => (Math.abs(weight - wanted) < Math.abs(best - wanted) ? weight : best),
    LOADED_WEIGHTS[0],
  );
  return brandFont.faces[nearest];
}
