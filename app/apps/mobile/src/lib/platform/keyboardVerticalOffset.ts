import { Platform } from 'react-native';

export interface KeyboardVerticalOffsetOptions {
  /** Custom header height (e.g. chat thread header). Overrides inferred stack header. */
  readonly headerHeight?: number;
  /** Screen has no stack header — offset is top safe inset only (auth / onboarding). */
  readonly headerless?: boolean;
  /**
   * Top safe area is already consumed by `Screen` / layout — offset is header chrome only.
   * Use for tab inline headers (create) below the notch inset.
   */
  readonly contentBelowTopSafeArea?: boolean;
}

/**
 * `behavior` for `<KeyboardAvoidingView>` (FR-RESP-006 AC5).
 *
 * The app is edge-to-edge on Android (`enableEdgeToEdge`, target SDK 36), so the system no longer
 * resizes the window for the keyboard (`softwareKeyboardLayoutMode: resize` has no effect) and a
 * sticky footer stays hidden behind it unless the view shrinks itself. iOS pads the bottom; Android
 * shrinks the height, as the chat and post-detail screens already do. Web has no software keyboard.
 */
export function resolveKeyboardAvoidingBehavior(
  platformOs: typeof Platform.OS,
): 'padding' | 'height' | undefined {
  if (platformOs === 'ios') return 'padding';
  if (platformOs === 'android') return 'height';
  return undefined;
}

/** Pure resolver — unit-tested; hook wraps this with live header height. */
export function resolveKeyboardVerticalOffset(
  platformOs: typeof Platform.OS,
  topInset: number,
  inferredHeaderHeight: number,
  options: KeyboardVerticalOffsetOptions = {},
): number {
  if (platformOs !== 'ios') return 0;
  if (options.headerless) return topInset;
  const header = options.headerHeight ?? inferredHeaderHeight;
  if (options.contentBelowTopSafeArea) return header;
  return header + topInset;
}
