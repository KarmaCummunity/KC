// Mapped to spec: FR-RESP-006 AC25 — scroll a form field into view on every platform.
import { AccessibilityInfo, findNodeHandle, Platform, type ScrollView, type View } from 'react-native';
import { spacing } from '@kc/ui';

/** Space kept above a field scrolled to, so its label is not glued to the top edge. */
export const SCROLL_TOP_PADDING = spacing.base;

/** Anything that can report its window position. */
type Measurable = Pick<View, 'measureInWindow'>;

/** RN Web often exposes the host element on the view ref; use the browser's scroll-into-view when possible. */
export function scrollWebFieldIntoView(node: Measurable): boolean {
  const host = node as unknown as { scrollIntoView?: (opts?: ScrollIntoViewOptions) => void };
  if (typeof host.scrollIntoView !== 'function') return false;
  host.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return true;
}

/** Native: the field's offset inside the scroller, from the two window positions plus the current scroll. */
export function scrollFieldWithWindow(scroll: ScrollView, node: Measurable, scrollY: number, pad: number): void {
  const host = scroll as unknown as Measurable;
  host.measureInWindow((_sx, sy) => {
    node.measureInWindow((_fx, fy) => {
      scroll.scrollTo({ y: Math.max(0, scrollY + (fy - sy) - pad), animated: true });
    });
  });
}

/** Window-coordinate geometry of a field inside a scroller's visible area. */
export interface RevealGeometry {
  readonly fieldTop: number;
  readonly fieldBottom: number;
  /** Top of the scroller on screen. */
  readonly viewportTop: number;
  /** Lowest visible point: the scroller's bottom, or the top of the keyboard when that is higher. */
  readonly viewportBottom: number;
  /** Current scroll offset of the scroller. */
  readonly scrollY: number;
  /** Space kept between the field and the visible edges. */
  readonly pad: number;
}

/**
 * The scroll offset that shows the whole field, or null when it is already fully visible (so moving
 * between visible fields never shakes the screen). A field above the area, or one too tall to fit,
 * is aligned by its top; a field below it is aligned by its bottom, just above the keyboard.
 */
export function revealOffset(g: RevealGeometry): number | null {
  const top = g.viewportTop + g.pad;
  const bottom = g.viewportBottom - g.pad;
  if (g.fieldTop >= top && g.fieldBottom <= bottom) return null;
  const tooTall = g.fieldBottom - g.fieldTop > bottom - top;
  if (g.fieldTop < top || tooTall) return Math.max(0, g.scrollY + g.fieldTop - top);
  return g.scrollY + g.fieldBottom - bottom;
}

/**
 * Native: scrolls just enough for a field reached with keyboard Next / Previous to be fully visible
 * above the keyboard. `keyboardTop` is the keyboard's top edge on screen (null while it is closed).
 */
export function revealFieldAboveKeyboard(
  scroll: ScrollView,
  node: Measurable,
  scrollY: number,
  keyboardTop: number | null,
): void {
  const host = scroll as unknown as Measurable;
  host.measureInWindow((_sx, sy, _sw, sh) => {
    node.measureInWindow((_fx, fy, _fw, fh) => {
      const viewportBottom = keyboardTop === null ? sy + sh : Math.min(sy + sh, keyboardTop);
      const y = revealOffset({
        fieldTop: fy,
        fieldBottom: fy + fh,
        viewportTop: sy,
        viewportBottom,
        scrollY,
        pad: SCROLL_TOP_PADDING,
      });
      if (y !== null) scroll.scrollTo({ y, animated: true });
    });
  });
}

/** Moves the screen reader to the field, which then reads its label and error (native only). */
export function focusForScreenReader(node: Measurable): void {
  if (Platform.OS === 'web') return;
  const handle = findNodeHandle(node as unknown as Parameters<typeof findNodeHandle>[0]);
  if (handle !== null) AccessibilityInfo.setAccessibilityFocus(handle);
}
