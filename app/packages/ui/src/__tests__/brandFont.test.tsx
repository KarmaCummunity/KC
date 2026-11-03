import { createRef } from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StyleSheet } from 'react-native';
import { brandFontStyle } from '../components/BrandText';
import { brandFont, brandFontFamily, fontFamily, Text, TextInput } from '../index';

// Brand font — spec 17 §4 (D66).
describe('brandFontFamily', () => {
  it('maps every loaded weight to its own face', () => {
    for (const [weight, face] of Object.entries(brandFont.faces)) {
      expect(brandFontFamily(weight)).toBe(face);
      expect(brandFontFamily(Number(weight))).toBe(face);
    }
  });

  it('treats a missing weight and "normal" as regular, and "bold" as 700', () => {
    expect(brandFontFamily()).toBe(brandFont.faces[400]);
    expect(brandFontFamily('normal')).toBe(brandFont.faces[400]);
    expect(brandFontFamily('bold')).toBe(brandFont.faces[700]);
  });

  it('snaps weights that are not loaded to the nearest loaded face', () => {
    expect(brandFontFamily('300')).toBe(brandFont.faces[400]);
    expect(brandFontFamily('900')).toBe(brandFont.faces[800]);
    expect(brandFontFamily('ultralight')).toBe(brandFont.faces[400]);
  });

  it('exposes the regular face as the typography fontFamily', () => {
    expect(fontFamily).toBe(brandFont.faces[400]);
  });
});

describe('brandFontStyle', () => {
  const resolved = (...args: Parameters<typeof brandFontStyle>) => StyleSheet.flatten(brandFontStyle(...args));

  it('gives unstyled text the regular face', () => {
    expect(resolved(undefined, false)).toMatchObject({ fontFamily: brandFont.faces[400] });
  });

  it('resolves the face from fontWeight across style arrays and drops the synthetic weight', () => {
    expect(resolved([{ fontSize: 14 }, { fontWeight: '700' }], false)).toEqual({
      fontSize: 14,
      fontFamily: brandFont.faces[700],
      fontWeight: 'normal',
    });
  });

  it('keeps an explicit fontFamily (e.g. monospace logs)', () => {
    expect(resolved({ fontFamily: 'monospace', fontWeight: '700' }, false)).toEqual({
      fontFamily: 'monospace',
      fontWeight: '700',
    });
  });

  it('lets nested text without a weight inherit its parent face', () => {
    expect(resolved({ color: 'red' }, true)).toEqual({ color: 'red' });
  });

  it('still resolves nested text that sets its own weight', () => {
    expect(resolved({ fontWeight: '600' }, true)).toMatchObject({ fontFamily: brandFont.faces[600] });
  });

  it('leaves the style untouched when the brand faces failed to load, keeping the real weight', () => {
    expect(resolved({ fontSize: 14, fontWeight: '700' }, false, false)).toEqual({ fontSize: 14, fontWeight: '700' });
  });
});

describe('Text / TextInput components', () => {
  it('render their content and forward refs to the native element', () => {
    const textRef = createRef<Text>();
    const inputRef = createRef<TextInput>();
    const { getByText, getByDisplayValue } = render(
      <>
        <Text ref={textRef}>
          קהילת <Text>קארמה</Text>
        </Text>
        <TextInput ref={inputRef} value="קלט" />
      </>,
    );
    expect(getByText('קארמה')).toBeTruthy();
    expect(getByDisplayValue('קלט')).toBeTruthy();
    expect(textRef.current).not.toBeNull();
    expect(inputRef.current).not.toBeNull();
  });
});
