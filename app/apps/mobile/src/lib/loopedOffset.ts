// Mapped to spec: FR-POST-001 AC1 — the arithmetic of a sideways row that scrolls in a circle: the row
// holds identical copies of its items and is kept on the middle one (`CreateCategoryLoopRow`).

/**
 * The offset showing the same content as `offset` from the middle copy, or `offset` itself while the
 * visible area still overlaps the middle copy. Moving only once the middle copy is entirely out of
 * view keeps every item of the middle copy reachable (its chips carry the ids screen readers and
 * tests use). `period` is the distance from one copy to the next (its width plus the gap), which is
 * what makes the content repeat; `viewport` is the visible width.
 */
export function loopedOffset(offset: number, middleStart: number, period: number, viewport: number): number {
  if (period <= 0) return offset;
  if (offset + viewport <= middleStart) return offset + period;
  if (offset >= middleStart + period) return offset - period;
  return offset;
}
