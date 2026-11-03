// @vitest-environment jsdom
// Shared Chip (spec 17 §4.1, issue #1285): filter, tag and removable variants, sizes, states.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider, contrastRatio, darkColors, lightColors, type ColorPalette } from '@kc/ui';

vi.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}));

import { Chip } from '../Chip';
import { toneColors, type ChipTone } from '../chipStyles';

afterEach(cleanup);

const withTheme = (ui: React.ReactElement) =>
  render(<ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>{ui}</ThemeProvider>);

/** jsdom reports colours as `rgb(r, g, b)`; convert a token hex to compare. */
function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

describe('Chip — filter (default variant)', () => {
  it('is a checkbox named by its label that reports its selected state', () => {
    const { getByRole, rerender } = withTheme(<Chip label="Furniture" onPress={() => {}} />);
    const chip = getByRole('checkbox', { name: 'Furniture' });
    expect(chip.getAttribute('aria-checked')).toBe('false');
    expect(getComputedStyle(chip).backgroundColor).toBe(rgb(lightColors.surface));
    rerender(
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <Chip label="Furniture" selected onPress={() => {}} />
      </ThemeProvider>,
    );
    expect(chip.getAttribute('aria-checked')).toBe('true');
    expect(getComputedStyle(chip).backgroundColor).toBe(rgb(lightColors.primary));
  });

  it('calls onPress when tapped', () => {
    const onPress = vi.fn();
    const { getByRole } = withTheme(<Chip label="Books" onPress={onPress} />);
    fireEvent.click(getByRole('checkbox', { name: 'Books' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('blocks presses and reports the state while disabled', () => {
    const onPress = vi.fn();
    const { getByRole } = withTheme(<Chip label="Books" disabled onPress={onPress} />);
    const chip = getByRole('checkbox', { name: 'Books' });
    fireEvent.click(chip);
    expect(onPress).not.toHaveBeenCalled();
    expect(chip.getAttribute('aria-disabled')).toBe('true');
  });

  it('is at least one touch target wide, 36pt tall at md and 28pt at the compact sm', () => {
    const { getByRole } = withTheme(
      <>
        <Chip label="md" onPress={() => {}} />
        <Chip label="sm" size="sm" icon="pricetag-outline" onPress={() => {}} />
      </>,
    );
    const md = getComputedStyle(getByRole('checkbox', { name: 'md' }));
    const sm = getComputedStyle(getByRole('checkbox', { name: 'sm' }));
    expect(md.minHeight).toBe('36px');
    expect(sm.minHeight).toBe('28px');
    expect(sm.minWidth).toBe('44px');
  });
});

describe('Chip — tag', () => {
  it('is a read-only label tinted by its tone, with a leading icon', () => {
    const { getByText, getByTestId, queryByRole } = withTheme(
      <Chip variant="tag" tone="success" icon="checkmark-circle" label="Done" testID="status" />,
    );
    expect(getByText('Done')).toBeTruthy();
    expect(getByTestId('icon-checkmark-circle')).toBeTruthy();
    expect(queryByRole('button')).toBeNull();
    expect(queryByRole('checkbox')).toBeNull();
    expect(getComputedStyle(getByTestId('status')).backgroundColor).toBe(rgb(lightColors.successLight));
  });

  it('maps every tone to a token pair in both palettes, neutral by default', () => {
    expect(toneColors('brand', lightColors)).toEqual({
      background: lightColors.primarySurface,
      border: lightColors.primaryLight,
      foreground: lightColors.primary,
    });
    expect(toneColors('warning', darkColors)).toEqual({
      background: darkColors.warningLight,
      border: darkColors.warningLight,
      foreground: darkColors.textPrimary,
    });
    const { getByTestId } = withTheme(<Chip variant="tag" label="Open" testID="neutral" />);
    expect(getComputedStyle(getByTestId('neutral')).backgroundColor).toBe(rgb(lightColors.secondaryLight));
  });

  it('draws the muted tone as an outline with secondary text on whatever it sits on', () => {
    expect(toneColors('muted', darkColors)).toEqual({
      background: 'transparent',
      border: darkColors.borderStrong,
      foreground: darkColors.textSecondary,
    });
  });

  it('keeps every tone AA (4.5:1) in both palettes, the muted one on every page surface', () => {
    const tones: readonly ChipTone[] = ['neutral', 'brand', 'info', 'success', 'warning', 'error', 'muted'];
    const palettes: readonly ColorPalette[] = [lightColors, darkColors];
    for (const colors of palettes) {
      for (const tone of tones) {
        const { background, foreground } = toneColors(tone, colors);
        const fills = background === 'transparent' ? [colors.background, colors.surface, colors.surfaceRaised] : [background];
        for (const fill of fills) expect(contrastRatio(foreground, fill)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('Chip — removable', () => {
  it('is a button named by the remove label that calls onRemove', () => {
    const onRemove = vi.fn();
    const { getByRole, getByText, getByTestId } = withTheme(
      <Chip variant="removable" label="Haifa" removeAccessibilityLabel="Remove Haifa" onRemove={onRemove} />,
    );
    expect(getByText('Haifa')).toBeTruthy();
    expect(getByTestId('icon-close-circle')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'Remove Haifa' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('does not remove while disabled', () => {
    const onRemove = vi.fn();
    const { getByRole } = withTheme(
      <Chip variant="removable" label="Haifa" removeAccessibilityLabel="Remove Haifa" disabled onRemove={onRemove} />,
    );
    fireEvent.click(getByRole('button', { name: 'Remove Haifa' }));
    expect(onRemove).not.toHaveBeenCalled();
  });
});
