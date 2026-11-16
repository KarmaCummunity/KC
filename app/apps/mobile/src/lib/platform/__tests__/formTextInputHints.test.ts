// FR-RESP-006 — each field kind opens the keyboard that fits its content.
import { describe, expect, it } from 'vitest';
import { formInputKindProps, type FormInputKind } from '../formTextInputHints';

describe('formInputKindProps', () => {
  it.each<[FormInputKind, string | undefined]>([
    ['email', 'email-address'],
    ['phone', 'phone-pad'],
    ['integer', 'number-pad'],
    ['decimal', 'decimal-pad'],
    ['url', 'url'],
    ['date', 'numbers-and-punctuation'],
    ['time', 'numbers-and-punctuation'],
    ['streetNumber', 'numbers-and-punctuation'],
    ['text', undefined],
    ['name', undefined],
    ['password', undefined],
  ])('%s → keyboardType %s', (kind, keyboardType) => {
    expect(formInputKindProps[kind].keyboardType).toBe(keyboardType);
  });

  it('never autocapitalises or autocorrects machine-readable values', () => {
    for (const kind of ['email', 'url', 'date', 'time', 'password'] as const) {
      expect(formInputKindProps[kind].autoCapitalize).toBe('none');
    }
    expect(formInputKindProps.email.autoCorrect).toBe(false);
  });

  it('masks passwords and capitalises names', () => {
    expect(formInputKindProps.password.secureTextEntry).toBe(true);
    expect(formInputKindProps.name.autoCapitalize).toBe('words');
  });

  it('covers every kind', () => {
    expect(Object.keys(formInputKindProps).sort()).toEqual(
      ['date', 'decimal', 'email', 'integer', 'name', 'password', 'phone', 'streetNumber', 'text', 'time', 'url'],
    );
  });
});
