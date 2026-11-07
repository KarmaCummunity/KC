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
