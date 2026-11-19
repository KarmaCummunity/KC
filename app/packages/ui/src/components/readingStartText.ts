// ─────────────────────────────────────────────
// Default paragraph alignment for brand Text (FR-SETTINGS-018)
// ─────────────────────────────────────────────
//
// A react-native Text with no `textAlign` is "natural", and iOS resolves natural
// alignment and base direction from the DEVICE language, not the app's: on an
// English iPhone every Hebrew paragraph sits on the left and its trailing
// punctuation jumps to the wrong end. Android already lays paragraphs out in the
// app's layout direction, so this default only brings iOS in line with it.
//
// - `textAlign: 'left'` is the reading-start edge on native: React Native swaps
//   left/right under `I18nManager.forceRTL`, so it lands right in Hebrew and
//   left in English.
// - `writingDirection` (iOS only; Android ignores it) pins the paragraph's base
//   direction to the app language so punctuation and Latin runs order correctly.
// - Web returns nothing: `dir` on the html element already makes text start-aligned.
//
// The default goes BEFORE the caller's style, so an explicit `textAlign`
// (e.g. 'center') or `writingDirection` always wins.

import type { PlatformOSType, TextStyle } from 'react-native';

/** Empty object for web, so callers can spread or array it unconditionally. */
const NO_DEFAULT: TextStyle = Object.freeze({});

/**
 * The reading-start text style for a top-level Text.
 * @param platform `Platform.OS` of the running app.
 * @param isRtl Whether the app layout is right-to-left (`I18nManager.isRTL` on native).
 */
export function readingStartTextStyle(platform: PlatformOSType, isRtl: boolean): TextStyle {
  if (platform === 'web') return NO_DEFAULT;
  if (platform === 'ios') return { textAlign: 'left', writingDirection: isRtl ? 'rtl' : 'ltr' };
  return { textAlign: 'left' };
}
