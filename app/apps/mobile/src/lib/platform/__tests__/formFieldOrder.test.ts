// FR-RESP-006 — keyboard Next / Previous follows reading order, mirrored for RTL.
import { describe, expect, it } from 'vitest';
import { SAME_ROW_TOLERANCE_PX, compareReadingOrder, type FieldPosition } from '../formFieldOrder';

const sort = (items: Record<string, FieldPosition>, isRtl: boolean) =>
  Object.entries(items)
    .sort(([, a], [, b]) => compareReadingOrder(a, b, isRtl))
    .map(([name]) => name);

describe('compareReadingOrder', () => {
  it('orders fields top to bottom', () => {
    expect(sort({ low: { x: 0, y: 300 }, high: { x: 0, y: 40 } }, false)).toEqual(['high', 'low']);
  });

  it('LTR: on one row the left field comes first', () => {
    expect(sort({ right: { x: 200, y: 100 }, left: { x: 16, y: 100 } }, false)).toEqual(['left', 'right']);
  });

  it('RTL: on one row the right field comes first (house number after street)', () => {
    expect(sort({ left: { x: 16, y: 100 }, right: { x: 200, y: 100 } }, true)).toEqual(['right', 'left']);
  });

  it('treats a sub-tolerance vertical offset as the same row', () => {
    const jitter = SAME_ROW_TOLERANCE_PX - 1;
    expect(sort({ b: { x: 16, y: 100 + jitter }, a: { x: 200, y: 100 } }, true)).toEqual(['a', 'b']);
  });

  it('a row difference at the tolerance wins over horizontal position', () => {
    expect(sort({ lower: { x: 500, y: 100 + SAME_ROW_TOLERANCE_PX }, upper: { x: 0, y: 100 } }, true)).toEqual([
      'upper',
      'lower',
    ]);
  });
});
