import { describe, expect, it } from 'vitest';
import { scrubPii } from '../scrubPii';

describe('scrubPii', () => {
  it.each([
    '050-1234567', '0501234567', '050 123 4567', '+972-50-123-4567', '972501234567',
    '02-5551234', '03 555 1234', '+972 2 555 1234',
  ])('replaces the phone %s', (phone) => {
    const out = scrubPii(`להתקשר ${phone} בערב`);
    expect(out.text).toBe('להתקשר <PHONE> בערב');
    expect(out.removed.phone).toBe(1);
  });

  it('does not touch prices, dates, quantities or years', () => {
    const text = 'מחיר 3000 ש"ח, 04.11.2026, 12 קילו, שנת 2019, קומה 4';
    expect(scrubPii(text).text).toBe(text);
  });

  it('replaces e-mail addresses', () => {
    const out = scrubPii('כתבו ל dana.cohen+kc@example.co.il תודה');
    expect(out.text).toBe('כתבו ל <EMAIL> תודה');
    expect(out.removed.email).toBe(1);
  });

  it('replaces URLs before digits inside them can be mistaken for a phone', () => {
    const out = scrubPii('פרטים https://wa.me/972501234567?text=hi וגם www.example.com/x');
    expect(out.text).toBe('פרטים <URL> וגם <URL>');
    expect(out.removed.url).toBe(2);
    expect(out.removed.phone).toBe(0);
  });

  it('replaces a 9-digit national id and card-like digit runs', () => {
    expect(scrubPii('ת.ז 123456789 תודה').text).toBe('ת.ז <ID> תודה');
    expect(scrubPii('כרטיס 4580 1234 5678 9012 תודה').text).toBe('כרטיס <ID> תודה');
  });

  it('counts every kind and is idempotent', () => {
    const first = scrubPii('050-1234567, 052-7654321, a@b.com');
    expect(first.removed).toEqual({ phone: 2, email: 1, id: 0, url: 0 });
    expect(scrubPii(first.text).text).toBe(first.text);
  });
});
