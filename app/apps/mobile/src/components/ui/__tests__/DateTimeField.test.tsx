// @vitest-environment jsdom
// FR-POST-001 AC6 / G49 — the tap-to-open date field: empty state, the date sheet (web input),
// done / cancel, shortcuts, and the `datetime-local` value helpers; on iOS, the native spinner
// is drawn in the app's theme (#1398).
import React from 'react';
import { Platform } from 'react-native';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { darkColors, lightColors, ThemeProvider, type ThemeMode } from '@kc/ui';

vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }) }));
// The native picker records the props of its last render, so a test can read what iOS would draw.
const nativePicker = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));
vi.mock('@react-native-community/datetimepicker', () => ({
  default: (props: Record<string, unknown>) => {
    nativePicker.props = props;
    return null;
  },
  DateTimePickerAndroid: { open: vi.fn() },
}));

import {
  applyAndroidClock,
  DateTimeField,
  fromWebInputValue,
  fromWebLocalValue,
  toWebInputValue,
  toWebLocalValue,
} from '../DateTimeField';

function renderField(value: Date | null, onChange = vi.fn(), theme: ThemeMode = 'light') {
  render(
    <ThemeProvider mode={theme} systemScheme="light" setMode={() => {}}>
      <DateTimeField
        testID="when"
        value={value}
        onChange={onChange}
        label="מועד"
        placeholder="בחירת תאריך"
        shortcuts={[{ key: 'plus30', label: '+30', at: () => new Date(Date.now() + 30 * 60_000) }]}
      />
    </ThemeProvider>,
  );
  return onChange;
}

const originalOs = Platform.OS;

afterEach(() => {
  cleanup();
  Platform.OS = originalOs;
  nativePicker.props = null;
});

describe('DateTimeField', () => {
  it('shows the placeholder while empty', () => {
    renderField(null);
    expect(screen.getByText('בחירת תאריך')).toBeTruthy();
  });

  it('confirms the picked moment from the sheet', () => {
    const onChange = renderField(null);
    fireEvent.click(screen.getByLabelText('מועד'));
    const input = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2031-05-04T09:15' } });
    fireEvent.click(screen.getByTestId('when-done'));
    expect(onChange).toHaveBeenCalledWith(new Date('2031-05-04T09:15'));
  });

  it('cancel keeps the value untouched', () => {
    const onChange = renderField(new Date('2031-05-04T09:15'));
    fireEvent.click(screen.getByLabelText('מועד'));
    fireEvent.click(screen.getByText('dateTimeField.cancel'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a shortcut sets a moment relative to now', () => {
    const onChange = renderField(null);
    const before = Date.now();
    fireEvent.click(screen.getByText('+30'));
    const picked = (onChange.mock.calls[0]![0] as Date).getTime();
    expect(picked).toBeGreaterThanOrEqual(before + 30 * 60_000);
    expect(picked).toBeLessThan(before + 31 * 60_000);
  });

  it('round-trips the datetime-local format and rejects bad input', () => {
    const d = new Date(2031, 0, 2, 3, 4);
    expect(toWebLocalValue(d)).toBe('2031-01-02T03:04');
    expect(fromWebLocalValue('2031-01-02T03:04')).toEqual(d);
    expect(fromWebLocalValue('')).toBeNull();
  });

  // FR-RIDE-046 — recurring rides pick a day and a time apart.
  it('a date-only field confirms a day at midnight', () => {
    const onChange = vi.fn();
    render(
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <DateTimeField testID="day" mode="date" value={null} onChange={onChange} label="יום" />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByLabelText('יום'));
    const input = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2031-05-04' } });
    fireEvent.click(screen.getByTestId('day-done'));
    expect(onChange).toHaveBeenCalledWith(new Date(2031, 4, 4));
  });

  it('keeps the chosen day when Android returns a clock on today', () => {
    const day = new Date(2031, 4, 4, 8, 0, 30, 0);
    const clockFromToday = new Date(2026, 10, 9, 18, 45, 12, 0);
    expect(applyAndroidClock(day, clockFromToday)).toEqual(new Date(2031, 4, 4, 18, 45, 0, 0));
  });

  it('formats and reads the day and time inputs', () => {
    const base = new Date(2031, 0, 2, 3, 4);
    expect(toWebInputValue(base, 'date')).toBe('2031-01-02');
    expect(toWebInputValue(base, 'time')).toBe('03:04');
    expect(fromWebInputValue('2031-05-04', 'date', base)).toEqual(new Date(2031, 4, 4));
    expect(fromWebInputValue('09:15', 'time', base)).toEqual(new Date(2031, 0, 2, 9, 15));
    expect(fromWebInputValue('', 'time', base)).toBeNull();
  });

  // #1398 — the spinner followed the phone's appearance while the sheet followed the app's, so a
  // phone in dark mode drew white digits on the light sheet and the picker looked empty.
  it.each([
    ['light', 'light', lightColors.textPrimary],
    ['dark', 'dark', darkColors.textPrimary],
  ] as const)('on iOS draws the spinner in the app theme (%s)', (theme, variant, textColor) => {
    Platform.OS = 'ios';
    renderField(null, vi.fn(), theme);
    fireEvent.click(screen.getByLabelText('מועד'));
    expect(nativePicker.props).toMatchObject({ display: 'spinner', themeVariant: variant, textColor });
  });
});

