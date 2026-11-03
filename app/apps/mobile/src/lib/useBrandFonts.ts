// Loads the brand font faces declared in @kc/ui `brandFont` (spec 17 §4, D66).
// Keys must match `brandFont.faces`; swapping the brand font = change both.
import {
  Rubik_400Regular,
  Rubik_500Medium,
  Rubik_600SemiBold,
  Rubik_700Bold,
  Rubik_800ExtraBold,
} from '@expo-google-fonts/rubik';
import { useFonts } from 'expo-font';
import { brandFont } from '@kc/ui';

const BRAND_FONT_ASSETS = {
  [brandFont.faces[400]]: Rubik_400Regular,
  [brandFont.faces[500]]: Rubik_500Medium,
  [brandFont.faces[600]]: Rubik_600SemiBold,
  [brandFont.faces[700]]: Rubik_700Bold,
  [brandFont.faces[800]]: Rubik_800ExtraBold,
};

/** `loading` until the faces settle; `failed` makes text fall back to the system font. */
export type BrandFontStatus = 'loading' | 'loaded' | 'failed';

export function useBrandFonts(): BrandFontStatus {
  const [loaded, error] = useFonts(BRAND_FONT_ASSETS);
  if (error !== null) return 'failed';
  return loaded ? 'loaded' : 'loading';
}
