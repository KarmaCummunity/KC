import { describe, expect, it } from 'vitest';
import { NO_PERCENT, formatAdminPercent } from '../formatAdminPercent';

describe('formatAdminPercent', () => {
  it('renders a ratio as a whole percentage by default', () => {
    expect(formatAdminPercent(0.4167)).toBe('42%');
    expect(formatAdminPercent(0.426)).toBe('43%');
    expect(formatAdminPercent(0)).toBe('0%');
    expect(formatAdminPercent(1)).toBe('100%');
  });

  it('rounds a half up like the match-quality dashboard did', () => {
    expect(formatAdminPercent(0.125)).toBe('13%');
  });

  it('keeps the requested decimals for the margin of error', () => {
    expect(formatAdminPercent(0.09602, 1)).toBe('9.6%');
  });

  it('renders a missing value as a dash, never 0%', () => {
    expect(formatAdminPercent(null)).toBe(NO_PERCENT);
    expect(formatAdminPercent(Number.NaN)).toBe(NO_PERCENT);
    expect(formatAdminPercent(Number.POSITIVE_INFINITY)).toBe(NO_PERCENT);
  });

  it('clamps values outside 0..1', () => {
    expect(formatAdminPercent(1.2)).toBe('100%');
    expect(formatAdminPercent(-0.1)).toBe('0%');
  });
});
