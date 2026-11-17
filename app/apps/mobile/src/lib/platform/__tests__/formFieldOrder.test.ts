// FR-RESP-006 — keyboard Next / Previous follows reading order, mirrored for RTL.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAME_ROW_TOLERANCE_PX, sortByReadingOrder, type FieldPosition } from '../formFieldOrder';

const rtl = vi.hoisted(() => ({ value: true }));
vi.mock('../../rtlLayout', () => ({ isLayoutRtl: () => rtl.value }));

const sort = (items: Record<string, FieldPosition>, isRtl?: boolean) =>
  sortByReadingOrder(
    Object.entries(items).map(([name, position]) => ({ name, position })),
    isRtl,
  ).map((row) => row.name);

afterEach(() => {
  rtl.value = true;
});

describe('sortByReadingOrder', () => {
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

  it('groups drifting tops into rows from the top-most field, so the order is well defined', () => {
    // 0 and 6 share a row; 12 is a tolerance away from the row's first field, so it starts the next row.
    const half = SAME_ROW_TOLERANCE_PX - 2;
    expect(sort({ a: { x: 10, y: 0 }, b: { x: 300, y: half }, c: { x: 200, y: half * 2 } }, true)).toEqual(['b', 'a', 'c']);
  });

  it('defaults to the app layout direction, which on web comes from the document (not I18nManager)', () => {
    const row = { left: { x: 16, y: 100 }, right: { x: 200, y: 100 } };
    expect(sort(row)).toEqual(['right', 'left']);
    rtl.value = false;
    expect(sort(row)).toEqual(['left', 'right']);
  });
});
