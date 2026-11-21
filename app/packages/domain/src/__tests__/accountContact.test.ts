import { describe, it, expect } from 'vitest';
import { isSsoProvider, maskEmail, maskPhone, parseAuthProvider } from '../accountContact';

describe('parseAuthProvider — FR-SETTINGS-002 AC1', () => {
  it('reads the four sign-in methods the app knows', () => {
    expect(parseAuthProvider('google')).toBe('google');
    expect(parseAuthProvider('apple')).toBe('apple');
    expect(parseAuthProvider('phone')).toBe('phone');
    expect(parseAuthProvider('email')).toBe('email');
  });

  it('returns null for anything else', () => {
    expect(parseAuthProvider('github')).toBeNull();
    expect(parseAuthProvider(undefined)).toBeNull();
    expect(parseAuthProvider(42)).toBeNull();
  });
});

describe('isSsoProvider — FR-SETTINGS-002 AC3', () => {
  it('is true for the providers that manage the sign-in elsewhere', () => {
    expect(isSsoProvider('google')).toBe(true);
    expect(isSsoProvider('apple')).toBe(true);
    expect(isSsoProvider('email')).toBe(false);
    expect(isSsoProvider('phone')).toBe(false);
    expect(isSsoProvider(null)).toBe(false);
  });
});

describe('maskEmail', () => {
  it('keeps the first and last letter of the name and the whole domain', () => {
    expect(maskEmail('dana.levi@example.com')).toBe('d•••i@example.com');
  });

  it('hides every letter after the first in a short name', () => {
    expect(maskEmail('ab@example.com')).toBe('a•••@example.com');
    expect(maskEmail('a@example.com')).toBe('a•••@example.com');
  });

  it('hides everything when the text is not an address', () => {
    expect(maskEmail('not-an-email')).toBe('•••');
    expect(maskEmail('@example.com')).toBe('•••');
  });
});

describe('maskPhone', () => {
  it('shows only the last three digits and keeps the separators', () => {
    expect(maskPhone('+972 50-123-4567')).toBe('+••• ••-•••-•567');
    expect(maskPhone('0501234567')).toBe('•••••••567');
  });

  it('leaves a number of three digits or fewer as it is', () => {
    expect(maskPhone('123')).toBe('123');
  });
});
