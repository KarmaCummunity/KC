// Mapped to spec: FR-POST-001 AC6 — scroll the listing create form to the field with a publish problem.
import { InteractionManager, Platform, type ScrollView, type View } from 'react-native';
import { spacing } from '@kc/ui';

export const LISTING_SCROLL_TOP_PADDING = spacing.base;

interface ScrollArgs {
  readonly scroll: ScrollView;
  readonly content: View;
  readonly node: View;
  readonly scrollY: number;
}

/** After a failed publish, bring the invalid field (or the footer error) into view on every platform. */
export function scheduleScrollToListingField({ scroll, content, node, scrollY }: ScrollArgs & { readonly node: View | undefined }): () => void {
  const run = () => {
    if (!node) {
      scroll.scrollToEnd({ animated: true });
      return;
    }
    scrollListingFieldIntoView({ scroll, content, node, scrollY });
  };

  const afterLayout = () => {
    if (Platform.OS === 'android') InteractionManager.runAfterInteractions(run);
    else run();
  };

  const outer = requestAnimationFrame(() => {
    requestAnimationFrame(afterLayout);
  });
  return () => cancelAnimationFrame(outer);
}

export function scrollListingFieldIntoView({ scroll, content, node, scrollY }: ScrollArgs): void {
  if (Platform.OS === 'web' && scrollWebFieldIntoView(node)) return;

  const pad = LISTING_SCROLL_TOP_PADDING;
  node.measureLayout(
    content,
    (_x, y) => scroll.scrollTo({ y: Math.max(0, y - pad), animated: true }),
    () => scrollFieldWithWindow(scroll, node, scrollY, pad),
  );
}

/** RN Web often exposes the host element on the view ref; use the browser's scroll-into-view when possible. */
export function scrollWebFieldIntoView(node: View): boolean {
  const host = node as unknown as { scrollIntoView?: (opts?: ScrollIntoViewOptions) => void };
  if (typeof host.scrollIntoView !== 'function') return false;
  host.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return true;
}

function scrollFieldWithWindow(scroll: ScrollView, node: View, scrollY: number, pad: number) {
  scroll.measureInWindow((_sx, sy) => {
    node.measureInWindow((_fx, fy) => {
      const y = scrollY + (fy - sy) - pad;
      scroll.scrollTo({ y: Math.max(0, y), animated: true });
    });
  });
}
