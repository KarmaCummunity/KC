import { describe, it, expect } from 'vitest';
import {
  BIOGRAPHY_URL_PATTERN,
  EMAIL_PATTERN,
  STREET_NUMBER_PATTERN,
  containsBiographyUrl,
  MESSAGE_REACTION_TYPES,
  createAddress,
  isMessageReactionType,
} from '../value-objects';
import { ValidationError } from '../errors';

describe('createAddress', () => {
  it('returns a frozen-shape Address copy of the input when all required fields are present', () => {
    const out = createAddress({
      city: 'IL-001', cityName: 'Tel Aviv', street: 'Main', streetNumber: '12',
    });
    expect(out).toEqual({
      city: 'IL-001', cityName: 'Tel Aviv', street: 'Main', streetNumber: '12',
    });
  });

  it('throws ValidationError(field=city) when city is empty', () => {
    const call = () => createAddress({
      city: '', cityName: 'Tel Aviv', street: '', streetNumber: '',
    });
    expect(call).toThrow(ValidationError);
    let captured: ValidationError | undefined;
    try { call(); } catch (err) { captured = err as ValidationError; }
    expect(captured?.field).toBe('city');
  });

  it('throws ValidationError(field=cityName) when cityName is empty', () => {
    const call = () => createAddress({
      city: 'IL-001', cityName: '', street: '', streetNumber: '',
    });
    expect(call).toThrow(ValidationError);
    let captured: ValidationError | undefined;
    try { call(); } catch (err) { captured = err as ValidationError; }
    expect(captured?.field).toBe('cityName');
  });

  it('allows empty street + streetNumber (only city + cityName are required)', () => {
    expect(() => createAddress({
      city: 'IL-001', cityName: 'Tel Aviv', street: '', streetNumber: '',
    })).not.toThrow();
  });
});

describe('STREET_NUMBER_PATTERN', () => {
  it('matches plain digits', () => {
    expect(STREET_NUMBER_PATTERN.test('12')).toBe(true);
    expect(STREET_NUMBER_PATTERN.test('1')).toBe(true);
    expect(STREET_NUMBER_PATTERN.test('999')).toBe(true);
  });

  it('matches digits + a single Latin letter', () => {
    expect(STREET_NUMBER_PATTERN.test('12A')).toBe(true);
    expect(STREET_NUMBER_PATTERN.test('12a')).toBe(true);
  });

  it('matches digits + a single Hebrew letter (א..ת)', () => {
    expect(STREET_NUMBER_PATTERN.test('12א')).toBe(true);
    expect(STREET_NUMBER_PATTERN.test('5ת')).toBe(true);
  });

  it('rejects empty string, letter-only, and multi-letter suffixes', () => {
    expect(STREET_NUMBER_PATTERN.test('')).toBe(false);
    expect(STREET_NUMBER_PATTERN.test('A')).toBe(false);
    expect(STREET_NUMBER_PATTERN.test('12AB')).toBe(false);
  });

  it('rejects punctuation / spaces', () => {
    expect(STREET_NUMBER_PATTERN.test('12-A')).toBe(false);
    expect(STREET_NUMBER_PATTERN.test('12 A')).toBe(false);
    expect(STREET_NUMBER_PATTERN.test('12/3')).toBe(false);
  });
});

describe('EMAIL_PATTERN', () => {
  it('matches typical emails', () => {
    expect(EMAIL_PATTERN.test('alice@example.com')).toBe(true);
    expect(EMAIL_PATTERN.test('alice.bob+test@ex.co.il')).toBe(true);
    expect(EMAIL_PATTERN.test('a@b.io')).toBe(true);
  });

  it('rejects missing @ / TLD too short / empty local-part', () => {
    expect(EMAIL_PATTERN.test('alice.example.com')).toBe(false);
    expect(EMAIL_PATTERN.test('alice@example.c')).toBe(false);
    expect(EMAIL_PATTERN.test('@example.com')).toBe(false);
  });

  it('rejects whitespace anywhere', () => {
    expect(EMAIL_PATTERN.test(' alice@example.com')).toBe(false);
    expect(EMAIL_PATTERN.test('alice @example.com')).toBe(false);
  });
});

describe('containsBiographyUrl + BIOGRAPHY_URL_PATTERN — FR-PROFILE-014', () => {
  it('flags http(s):// prefixes', () => {
    expect(containsBiographyUrl('check http://example.com')).toBe(true);
    expect(containsBiographyUrl('https://example.com is mine')).toBe(true);
  });

  it('flags a bare www.* prefix', () => {
    expect(containsBiographyUrl('see www.example.com')).toBe(true);
  });

  it('flags a bare token with a TLD-like suffix (.co, .io, .com, etc.)', () => {
    expect(containsBiographyUrl('email me at alice.example.com')).toBe(true);
    expect(containsBiographyUrl('contact: org.io please')).toBe(true);
  });

  it('returns false for plain text without URLs or TLD-like tokens', () => {
    expect(containsBiographyUrl('I love giving things away')).toBe(false);
    expect(containsBiographyUrl('My name is Alice')).toBe(false);
  });

  // KC#1721: a dot between two words is not a domain unless the suffix is a real TLD.
  it('does not flag abbreviations, names and tech words that merely contain a dot', () => {
    expect(containsBiographyUrl('I write Node.js and Vue.js')).toBe(false);
    expect(containsBiographyUrl('Dr.Smith, e.g. a dentist')).toBe(false);
    expect(containsBiographyUrl('version 3.14, hello.world')).toBe(false);
    expect(containsBiographyUrl('אוהבת לעזור. גרה בלוד.')).toBe(false);
  });

  it('flags well-known shorteners and multi-label country domains (AC2)', () => {
    expect(containsBiographyUrl('bit.ly/x')).toBe(true);
    expect(containsBiographyUrl('see t.co/abc')).toBe(true);
    expect(containsBiographyUrl('tinyurl.com/abc')).toBe(true);
    expect(containsBiographyUrl('wa.me/972500000000')).toBe(true);
    expect(containsBiographyUrl('my site.co.il')).toBe(true);
    expect(containsBiographyUrl('write to name@mail.com')).toBe(true);
  });

  it('is case-insensitive (HTTPS, WWW. variants)', () => {
    expect(containsBiographyUrl('HTTPS://EXAMPLE.COM')).toBe(true);
    expect(containsBiographyUrl('WWW.EXAMPLE.COM')).toBe(true);
  });

  it('uses the exported pattern (the function is a thin wrapper, same semantics)', () => {
    const text = 'visit https://x.com';
    expect(containsBiographyUrl(text)).toBe(BIOGRAPHY_URL_PATTERN.test(text));
  });
});

describe('isMessageReactionType (KC#873, #2568)', () => {
  it('accepts every listed reaction type', () => {
    for (const type of MESSAGE_REACTION_TYPES) expect(isMessageReactionType(type)).toBe(true);
  });

  it('rejects unknown strings and non-strings', () => {
    for (const value of ['angry', '', 'LIKE', null, undefined, 1, {}]) expect(isMessageReactionType(value)).toBe(false);
  });
});
