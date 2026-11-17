// Mapped to spec: FR-RESP-006 — keyboard next/previous follows the on-screen reading order.
import { I18nManager, type View } from 'react-native';

/** Fields whose tops differ by less than this many px count as sitting on one row. */
export const SAME_ROW_TOLERANCE_PX = 8;

/** Anything that can report its window position: a field's wrapper `View` or a bare `TextInput`. */
export type FieldView = Pick<View, 'measureInWindow'>;

export interface FieldPosition {
  readonly x: number;
  readonly y: number;
}

/** Window-relative top-left corner of a view, or `null` when it is unmounted or not measurable. */
export function measureFieldPosition(view: FieldView | null): Promise<FieldPosition | null> {
  if (!view) return Promise.resolve(null);
  return new Promise((resolve) => {
    view.measureInWindow((x, y) => resolve(Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null));
  });
}

/**
 * Reading order: top to bottom, and within one row from the reading-start edge
 * (right in an RTL layout, left in LTR) towards the end.
 */
export function compareReadingOrder(a: FieldPosition, b: FieldPosition, isRtl: boolean = I18nManager.isRTL): number {
  if (Math.abs(a.y - b.y) >= SAME_ROW_TOLERANCE_PX) return a.y - b.y;
  return isRtl ? b.x - a.x : a.x - b.x;
}
