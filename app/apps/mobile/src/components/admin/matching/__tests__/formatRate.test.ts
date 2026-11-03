import { describe, it, expect } from 'vitest';
import { formatRate, NO_RATE } from '../formatRate';

describe('formatRate', () => {
  it('renders a ratio as a whole percentage', () => {
    expect(formatRate(0.4167)).toBe('42%');
    expect(formatRate(0)).toBe('0%');
    expect(formatRate(1)).toBe('100%');
  });

  it('renders a missing rate as a dash, not 0%', () => {
    expect(formatRate(null)).toBe(NO_RATE);
    expect(formatRate(Number.NaN)).toBe(NO_RATE);
  });

  it('clamps out-of-range values', () => {
    expect(formatRate(1.2)).toBe('100%');
    expect(formatRate(-0.1)).toBe('0%');
  });
});
