// Mapped to spec: FR-RESP-006 AC25 — scroll a form field into view on every platform.
import type { ScrollView, View } from 'react-native';
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
