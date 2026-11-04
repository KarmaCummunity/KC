import { describe, expect, it } from 'vitest';
import { formatMoney } from '../formatMoney';

describe('formatMoney', () => {
  it('formats whole shekels without decimals', () => {
    const out = formatMoney(120000);
    expect(out).toContain('1,200');
    expect(out).toContain('₪');
    expect(out).not.toContain('.');
  });

  it('keeps two decimals for fractional amounts', () => {
    expect(formatMoney(120050)).toContain('1,200.50');
  });

  it('formats negatives', () => {
    expect(formatMoney(-500)).toContain('5');
    expect(formatMoney(-500)).toMatch(/-|‎|−/);
  });

  it('honours the locale', () => {
    expect(formatMoney(100000, 'ILS', 'en-IL')).toContain('1,000');
  });

  it('falls back to a plain string for an invalid currency code', () => {
    expect(formatMoney(1234, 'NOT-A-CODE')).toBe('12.34 NOT-A-CODE');
  });
});
