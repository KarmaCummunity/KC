import { I18nManager, Platform, type FlexStyle, type TextStyle, type ViewStyle } from 'react-native';

/**
 * Whether the app layout runs right-to-left.
 * Web reads `document.documentElement.dir`; native uses I18nManager.
 */
export function isLayoutRtl(): boolean {
  if (Platform.OS === 'web') {
    if (typeof document !== 'undefined') {
      const dir = document.documentElement.getAttribute('dir');
      if (dir === 'ltr' || dir === 'rtl') return dir === 'rtl';
    }
    return true;
  }
  return I18nManager.isRTL;
}

/**
 * Cross-axis inline-start. Pair with `layoutDirectionStyle()` on web so
 * `flex-start` resolves to the reading-start edge in both Hebrew and English.
 */
export const crossAxisAlignStart: FlexStyle['alignItems'] = 'flex-start';

/** Self-align to inline-start on the cross axis. */
export const selfAlignStart: FlexStyle['alignSelf'] = 'flex-start';

/** Main-axis inline-start for rows. */
export const mainAxisAlignStart: FlexStyle['justifyContent'] = 'flex-start';

/**
 * Legacy spread hook for web layout bidi. Intentionally empty: RN-Web does not
 * support CSS `direction` on views (see `webRtlStyle.ts`). Html `dir` + flex helpers
 * own layout direction; callers may keep `...layoutDirectionStyle()` harmlessly.
 */
export function layoutDirectionStyle(): ViewStyle {
  return {};
}

/** Web-only text `writingDirection` for the active locale. */
export function layoutWritingDirectionStyle(): TextStyle {
  if (Platform.OS !== 'web') return {};
  return { writingDirection: isLayoutRtl() ? 'rtl' : 'ltr' };
}

/**
 * `textAlign` toward the reading-start edge for the active layout direction.
 * - Web RTL (Hebrew, `dir="rtl"`): inline-start is physical `right`.
 * - Web LTR (English, `dir="ltr"`): inline-start is physical `left`.
 * - Native + `I18nManager.forceRTL`: physical `left` mirrors to inline-start.
 *
 * FR-SETTINGS-018: direction-aware on web so English aligns left. Typed as
 * `'left' | 'right'` (narrower than `TextStyle['textAlign']`) so it also satisfies the
 * `TextInput` `textAlign` prop, which excludes `'auto'` / `'justify'`.
 */
export function textAlignStart(): 'left' | 'right' {
  if (Platform.OS === 'web') return isLayoutRtl() ? 'right' : 'left';
  return 'left';
}

/**
 * `textAlign` toward the reading-start edge for a fixed-direction `TextInput` (numbers, codes;
 * FR-RESP-006 AC21). Unlike `<Text>`, native inputs do not mirror `left` / `right` under
 * `forceRTL`, so the physical edge is returned on every platform.
 */
export function inputTextAlignStart(): 'left' | 'right' {
  return isLayoutRtl() ? 'right' : 'left';
}

/**
 * Placeholder direction of an empty free-text input. Web resolves an empty `dir="auto"` input
 * as LTR, and iOS aligns an empty natural-aligned input by the device language, not the app's;
 * both would push a Hebrew placeholder to the left. Typed text keeps `auto` (FR-RESP-006 AC21).
 */
export function emptyInputDirectionStyle(): TextStyle {
  if (Platform.OS === 'web') {
    return { ...layoutWritingDirectionStyle(), textAlign: inputTextAlignStart() };
  }
  return { textAlign: inputTextAlignStart() };
}

/** {@link textAlignStart} resolved once at module load (the app reloads on a language switch). */
export const rtlTextAlignStart: 'left' | 'right' = textAlignStart();

/**
 * Reading-end edge (visual left in RTL Hebrew, visual right in LTR English).
 * Pair with actions such as a "show all" affordance pinned to the end gutter.
 */
export const rtlTextAlignEnd: 'left' | 'right' = rtlTextAlignStart === 'left' ? 'right' : 'left';

/**
 * `flexDirection` for a row laid out from the reading-start edge.
 *
 * Why this exists: the app forces RTL on both platforms (web `dir=rtl`,
 * native `I18nManager.forceRTL(true)`). Native auto-mirrors `flexDirection: 'row'`,
 * so writing `'row-reverse'` there causes a **double flip** back to LTR.
 * RN-Web with `dir=rtl` does *not* auto-mirror `flexDirection: 'row'` in the
 * same way, so web needs the explicit `'row-reverse'` to read right-to-left.
 *
 * Use this helper anywhere a row should follow the active reading direction.
 * If you actually want a physically reversed row (LTR-style on an RTL app),
 * write `'row-reverse'` directly and add a comment explaining why.
 */
// FR-SETTINGS-018: direction-aware on web. RTL (Hebrew) reads right-to-left via
// `row-reverse`; LTR (English) uses a plain `row`. Native auto-mirrors `row`, so
// it stays `row` regardless. Re-resolves after a language switch (the app reloads).
export const rowDirectionStart: FlexStyle['flexDirection'] =
  Platform.OS === 'web' ? (isLayoutRtl() ? 'row-reverse' : 'row') : 'row';

/** Counterpart of {@link rowDirectionStart} for rows that should run end-to-start. */
export const rowDirectionEnd: FlexStyle['flexDirection'] =
  Platform.OS === 'web' ? (isLayoutRtl() ? 'row' : 'row-reverse') : 'row-reverse';
