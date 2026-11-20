import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Platform } from 'react-native';
import { readingStartTextStyle } from '../components/readingStartText';
import { Text } from '../index';

// FR-SETTINGS-018 — text starts at the app's reading edge, not the device language's.
describe('readingStartTextStyle', () => {
  it('pins iOS paragraphs to the app direction, whatever the device language', () => {
    expect(readingStartTextStyle('ios', true)).toEqual({ textAlign: 'left', writingDirection: 'rtl' });
    expect(readingStartTextStyle('ios', false)).toEqual({ textAlign: 'left', writingDirection: 'ltr' });
  });

  it('gives Android only the start alignment: its paragraphs already follow the layout direction', () => {
    expect(readingStartTextStyle('android', true)).toEqual({ textAlign: 'left' });
  });

  it('adds nothing on web, where the html `dir` already aligns text to the start', () => {
    expect(readingStartTextStyle('web', true)).toEqual({});
  });
});

describe('Text reading-start default', () => {
  const webOS = Platform.OS;
  // react-native is aliased to react-native-web here; switch its OS to drive the native branch.
  const runAs = (os: typeof Platform.OS) => Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  const alignOf = (element: HTMLElement) => window.getComputedStyle(element).textAlign;

  afterEach(() => runAs(webOS));

  it('aligns a top-level native Text to the reading start', () => {
    runAs('android');
    const { getByText } = render(<Text>שלום</Text>);
    expect(alignOf(getByText('שלום'))).toBe('left');
  });

  it('lets an explicit alignment win over the default', () => {
    runAs('android');
    const { getByText } = render(<Text style={{ textAlign: 'center' }}>כותרת</Text>);
    expect(alignOf(getByText('כותרת'))).toBe('center');
  });

  it('leaves nested spans to their paragraph, so a centered sentence stays centered', () => {
    runAs('android');
    const { getByText } = render(
      <Text style={{ textAlign: 'center' }}>
        קהילת <Text>קארמה</Text>
      </Text>,
    );
    expect(alignOf(getByText('קארמה'))).not.toBe('left');
  });
});
