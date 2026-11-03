import { describe, expect, it } from 'vitest';
import { NO_SHARE, formatPmfPercent } from '../formatPmfPercent';

describe('formatPmfPercent', () => {
  it('formats a share as a whole percent by default', () => {
    expect(formatPmfPercent(0.4)).toBe('40%');
    expect(formatPmfPercent(0.426)).toBe('43%');
  });

  it('keeps the requested decimals for the margin of error', () => {
    expect(formatPmfPercent(0.09602, 1)).toBe('9.6%');
  });

  it('renders a missing share as a dash, never 0%', () => {
    expect(formatPmfPercent(null)).toBe(NO_SHARE);
    expect(formatPmfPercent(Number.NaN)).toBe(NO_SHARE);
  });

  it('clamps values outside 0..1', () => {
    expect(formatPmfPercent(1.2)).toBe('100%');
    expect(formatPmfPercent(-0.1)).toBe('0%');
  });
});
