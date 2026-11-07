// @vitest-environment jsdom
// Shared buttons (spec 17 §4.1, issue #1286): variants, sizes, loading / disabled, tap target.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider, darkColors, lightColors } from '@kc/ui';

// Reanimated does not transform under Vitest; the press scale is not under test here.
vi.mock('react-native-reanimated', async () => {
  const { View } = await vi.importActual<typeof import('react-native')>('react-native');
  return {
    default: { View },
    useSharedValue: (value: number) => ({ value }),
    useAnimatedStyle: () => ({}),
    withSpring: (value: number) => value,
    withTiming: (value: number) => value,
  };
});
const hapticLightImpact = vi.fn();
vi.mock('../../../lib/haptics', () => ({ hapticLightImpact: () => hapticLightImpact() }));
vi.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}));
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => false }));

import { AlertButton, DangerButton, GhostButton, PrimaryButton, SecondaryButton } from '../Buttons';
import { MIN_TAP_TARGET, tapTargetHitSlop } from '../kitMetrics';

afterEach(cleanup);
beforeEach(() => hapticLightImpact.mockClear());

const withTheme = (ui: React.ReactElement, scheme: 'light' | 'dark' = 'light') =>
  render(<ThemeProvider mode={scheme} systemScheme={scheme} setMode={() => {}}>{ui}</ThemeProvider>);

/** jsdom reports colours as `rgb(r, g, b)`; convert a token hex to compare. */
function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

describe('kit buttons', () => {
  it('names the button with its label, presses through and plays a light haptic', () => {
    const onPress = vi.fn();
    const { getByRole } = withTheme(<PrimaryButton label="Publish" onPress={onPress} />);
    const button = getByRole('button', { name: 'Publish' });
    fireEvent.click(button);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(hapticLightImpact).toHaveBeenCalledTimes(1);
  });

  it('skips the haptic when asked and prefers an explicit accessibility label', () => {
    const onPress = vi.fn();
    const { getByRole } = withTheme(
      <SecondaryButton label="Open" accessibilityLabel="Open the partner site" haptic={false} onPress={onPress} />,
    );
    fireEvent.click(getByRole('button', { name: 'Open the partner site' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(hapticLightImpact).not.toHaveBeenCalled();
  });

  it('blocks presses and reports the state while disabled', () => {
    const onPress = vi.fn();
    const { getByRole } = withTheme(<PrimaryButton label="Send" disabled onPress={onPress} />);
    const button = getByRole('button', { name: 'Send' });
    fireEvent.click(button);
    expect(onPress).not.toHaveBeenCalled();
    expect(button.getAttribute('aria-disabled')).toBe('true');
  });

  it('shows a spinner, keeps the label in the layout and blocks presses while loading', () => {
    const onPress = vi.fn();
    const { getByRole, getByText } = withTheme(
      <GhostButton label="Save" icon="checkmark" size="md" loading onPress={onPress} />,
    );
    const button = getByRole('button', { name: 'Save' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(getByRole('progressbar')).toBeTruthy();
    // The label still sizes the button, but is not drawn.
    expect(getComputedStyle(getByText('Save')).opacity).toBe('0');
    fireEvent.click(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('keeps the original 56pt height by default and steps down for md and the compact sm', () => {
    const heights = (['lg', 'md', 'sm'] as const).map((size) => {
      const { getByRole, unmount } = withTheme(<PrimaryButton label={size} size={size === 'lg' ? undefined : size} onPress={() => {}} />);
      const height = getComputedStyle(getByRole('button', { name: size })).height;
      unmount();
      return height;
    });
    expect(heights).toEqual(['56px', '48px', '36px']);
  });

  it('renders the Ionicons glyph or a custom icon node', () => {
    const { getByTestId } = withTheme(
      <>
        <PrimaryButton label="Go" icon="arrow-back" onPress={() => {}} />
        <SecondaryButton label="Google" iconNode={<span data-testid="brand-logo" />} onPress={() => {}} />
      </>,
    );
    expect(getByTestId('icon-arrow-back')).toBeTruthy();
    expect(getByTestId('brand-logo')).toBeTruthy();
  });
});

describe('DangerButton (D94)', () => {
  it('fills with the error token and labels in textInverse, in both palettes', () => {
    for (const [scheme, palette] of [['light', lightColors], ['dark', darkColors]] as const) {
      const onPress = vi.fn();
      const { getByRole, getByText, unmount } = withTheme(<DangerButton label="Delete" onPress={onPress} />, scheme);
      const button = getByRole('button', { name: 'Delete' });
      expect(getComputedStyle(button).backgroundColor).toBe(rgb(palette.error));
      expect(getComputedStyle(getByText('Delete')).color).toBe(rgb(palette.textInverse));
      fireEvent.click(button);
      expect(onPress).toHaveBeenCalledTimes(1);
      unmount();
    }
  });

  it('blocks presses and reports the state while disabled', () => {
    const onPress = vi.fn();
    const { getByRole } = withTheme(<DangerButton label="Block" size="sm" disabled onPress={onPress} />);
    const button = getByRole('button', { name: 'Block' });
    fireEvent.click(button);
    expect(onPress).not.toHaveBeenCalled();
    expect(button.getAttribute('aria-disabled')).toBe('true');
  });

  it('shows a spinner, announces busy and blocks presses while loading', () => {
    const onPress = vi.fn();
    const { getByRole } = withTheme(<DangerButton label="Remove" size="md" loading onPress={onPress} />);
    const button = getByRole('button', { name: 'Remove' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(getByRole('progressbar')).toBeTruthy();
    fireEvent.click(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('AlertButton (spec 17 §8.1 call 7)', () => {
  it('outlines the surface in the error token and inks the label and glyph in it, in both palettes', () => {
    for (const [scheme, palette] of [['light', lightColors], ['dark', darkColors]] as const) {
      const onPress = vi.fn();
      const { getByRole, getByText, getByTestId, unmount } = withTheme(
        <AlertButton label="Call for help" icon="alert-circle-outline" size="md" onPress={onPress} />,
        scheme,
      );
      const button = getByRole('button', { name: 'Call for help' });
      const style = getComputedStyle(button);
      expect(style.backgroundColor).toBe(rgb(palette.surface));
      expect(style.borderTopColor).toBe(rgb(palette.error));
      expect(getComputedStyle(getByText('Call for help')).color).toBe(rgb(palette.error));
      expect(getByTestId('icon-alert-circle-outline')).toBeTruthy();
      fireEvent.click(button);
      expect(onPress).toHaveBeenCalledTimes(1);
      unmount();
    }
  });

  it('shows a spinner, announces busy and blocks presses while loading', () => {
    const onPress = vi.fn();
    const { getByRole } = withTheme(<AlertButton label="Send now" size="md" loading onPress={onPress} />);
    const button = getByRole('button', { name: 'Send now' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(getByRole('progressbar')).toBeTruthy();
    fireEvent.click(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('tapTargetHitSlop', () => {
  it('grows a short control to the 44pt target, split evenly above and below', () => {
    expect(tapTargetHitSlop(36)).toEqual({ top: 4, bottom: 4 });
    expect(tapTargetHitSlop(28)).toEqual({ top: 8, bottom: 8 });
  });

  it('adds no slop to a control that is already tall enough (boundary: exactly 44pt)', () => {
    expect(tapTargetHitSlop(MIN_TAP_TARGET)).toBeUndefined();
    expect(tapTargetHitSlop(56)).toBeUndefined();
  });
});
