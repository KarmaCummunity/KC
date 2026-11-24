// #1747 — On RTL web, `rowDirectionStart` is `row-reverse`, so a horizontal
// ScrollView starts at scrollX=0 (the reading-end). Jump to the end so the
// first chip sits on the reading-start edge. Native and LTR are no-ops.
import { useCallback, useRef, type RefObject } from 'react';
import { Platform, type ScrollView } from 'react-native';
import { isLayoutRtl } from '../lib/rtlLayout';

/** True only when a horizontal ScrollView must jump to the reading-start edge. */
export function shouldScrollHorizontalToRtlStart(): boolean {
  return Platform.OS === 'web' && isLayoutRtl();
}

/**
 * Scroll a horizontal ScrollView so the reading-start edge is visible.
 * Safe to call with a null ref; no-op on native and LTR.
 */
export function scrollHorizontalToRtlStart(scroll: ScrollView | null): void {
  if (!scroll || !shouldScrollHorizontalToRtlStart()) return;
  scroll.scrollToEnd({ animated: false });
}

/**
 * Ref + `onContentSizeChange` for a horizontal ScrollView whose content uses
 * `rowDirectionStart`. Attach both so the first chip is on-screen on RTL web
 * after mount and whenever the chip list grows or shrinks.
 */
export function useRtlWebHorizontalScrollStart(): {
  readonly ref: RefObject<ScrollView | null>;
  readonly onContentSizeChange: (width: number, height: number) => void;
} {
  const ref = useRef<ScrollView | null>(null);
  const onContentSizeChange = useCallback((_width: number, _height: number) => {
    scrollHorizontalToRtlStart(ref.current);
  }, []);
  return { ref, onContentSizeChange };
}
