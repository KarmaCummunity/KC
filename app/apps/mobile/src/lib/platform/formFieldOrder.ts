// Mapped to spec: FR-RESP-006 — keyboard next/previous follows the on-screen reading order.
import type { View } from 'react-native';
import { isLayoutRtl } from '../rtlLayout';

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
 * Sorts items into reading order: top to bottom, and within one row from the reading-start edge
 * (right in an RTL layout, left in LTR) towards the end.
 *
 * Rows are formed first and sorted second, so the result is well defined even when tops drift:
 * a field joins the current row while its top is within `SAME_ROW_TOLERANCE_PX` of the row's
 * first (top-most) field. A pairwise "close enough" comparator would not be transitive.
 */
export function sortByReadingOrder<T extends { readonly position: FieldPosition }>(
  items: readonly T[],
  isRtl: boolean = isLayoutRtl(),
): T[] {
  const byTop = [...items].sort((a, b) => a.position.y - b.position.y);
  const rows: T[][] = [];
  for (const item of byTop) {
    const row = rows[rows.length - 1];
    if (row && item.position.y - row[0]!.position.y < SAME_ROW_TOLERANCE_PX) row.push(item);
    else rows.push([item]);
  }
  const inRow = (a: T, b: T) => (isRtl ? b.position.x - a.position.x : a.position.x - b.position.x);
  return rows.flatMap((row) => row.sort(inRow));
}
