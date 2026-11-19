// FR-POST-001 AC6 — the category row loops: once the middle copy of the chips is fully out of view,
// the offset jumps exactly one period, which shows the same chips, so the jump cannot be seen.
import { describe, expect, it } from 'vitest';
import { loopedOffset } from '../loopedOffset';

// Three copies, each 1000 wide with an 8 gap: copy starts at 0, 1008 and 2016; a 360-wide screen.
const MIDDLE = 1008;
const PERIOD = 1008;
const VIEWPORT = 360;
const loop = (offset: number) => loopedOffset(offset, MIDDLE, PERIOD, VIEWPORT);

describe('loopedOffset', () => {
  it('leaves the offset alone while any of the middle copy is on screen, so all of its chips are reachable', () => {
    expect(loop(MIDDLE)).toBe(MIDDLE);
    expect(loop(MIDDLE + PERIOD - 1)).toBe(MIDDLE + PERIOD - 1);
    expect(loop(MIDDLE - VIEWPORT + 1)).toBe(MIDDLE - VIEWPORT + 1);
  });

  it('wraps past the last chip back to the same place in the middle copy', () => {
    expect(loop(MIDDLE + PERIOD + 50)).toBe(MIDDLE + 50);
  });

  it('wraps before the first chip forward to the same place in the middle copy', () => {
    expect(loop(MIDDLE - VIEWPORT - 50)).toBe(MIDDLE - VIEWPORT - 50 + PERIOD);
  });

  it('does nothing before the copies are measured', () => {
    expect(loopedOffset(300, 0, 0, VIEWPORT)).toBe(300);
  });
});
