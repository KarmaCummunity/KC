// @vitest-environment jsdom
// Shared TextField (spec 17 §4.1, issue #1283): label, helper / error, states, ref.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { createRef } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider, lightColors, type TextInput } from '@kc/ui';

vi.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import { TextField } from '../TextField';

afterEach(cleanup);

const withTheme = (ui: React.ReactElement) =>
  render(<ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>{ui}</ThemeProvider>);

/** The bordered box is the input's parent (the Pressable). */
const fieldBorderColor = (input: HTMLElement) => getComputedStyle(input.parentElement as HTMLElement).borderTopColor;

/** jsdom reports colours as `rgb(r, g, b)`; convert a token hex to compare. */
function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

describe('TextField', () => {
  it('renders the label and helper text, and names the input with the label', () => {
    const { getByText, getByLabelText } = withTheme(
      <TextField label="Email" helperText="We never share it" placeholder="name@example.com" />,
    );
    expect(getByText('Email')).toBeTruthy();
    expect(getByText('We never share it')).toBeTruthy();
    const input = getByLabelText('Email') as HTMLInputElement;
    expect(input.placeholder).toBe('name@example.com');
  });

  it('shows the error instead of the helper and switches to the error state', () => {
    const { getByText, queryByText, getByRole, getByLabelText } = withTheme(
      <TextField label="Email" helperText="We never share it" errorText="Invalid address" />,
    );
    expect(getByText('Invalid address')).toBeTruthy();
    expect(queryByText('We never share it')).toBeNull();
    expect(getByRole('alert').textContent).toContain('Invalid address');
    // Screen readers hear the error together with the label.
    const input = getByLabelText('Email, Invalid address');
    expect(fieldBorderColor(input)).toBe(rgb(lightColors.error));
  });

  it('tints the border with primary on focus and resets on blur', () => {
    const { getByLabelText } = withTheme(<TextField label="Title" />);
    const input = getByLabelText('Title');
    expect(fieldBorderColor(input)).toBe(rgb(lightColors.border));
    fireEvent.focus(input);
    expect(fieldBorderColor(input)).toBe(rgb(lightColors.primary));
    fireEvent.blur(input);
    expect(fieldBorderColor(input)).toBe(rgb(lightColors.border));
  });

  it('keeps the error border while focused (error wins over focus)', () => {
    const { getByLabelText } = withTheme(<TextField label="Title" errorText="Required" />);
    const input = getByLabelText('Title, Required');
    fireEvent.focus(input);
    expect(fieldBorderColor(input)).toBe(rgb(lightColors.error));
  });

  it('forwards the ref to the native input', () => {
    const ref = createRef<TextInput>();
    const { getByLabelText } = withTheme(<TextField ref={ref} label="Name" />);
    expect(ref.current).toBe(getByLabelText('Name'));
    expect(typeof ref.current?.focus).toBe('function');
  });

  it('marks a non-editable field as disabled for assistive tech', () => {
    const { getByLabelText } = withTheme(<TextField label="City" editable={false} value="Haifa" />);
    const input = getByLabelText('City') as HTMLInputElement;
    expect(input.getAttribute('aria-disabled')).toBe('true');
    expect(input.readOnly).toBe(true);
  });

  it('passes value and onChangeText through to the input', () => {
    const onChangeText = vi.fn();
    const { getByLabelText } = withTheme(<TextField label="Name" value="Dana" onChangeText={onChangeText} />);
    const input = getByLabelText('Name') as HTMLInputElement;
    expect(input.value).toBe('Dana');
    fireEvent.change(input, { target: { value: 'Dana K' } });
    expect(onChangeText).toHaveBeenCalledWith('Dana K');
  });

  it('renders a leading icon, a textarea when multiline, and no helper row when none is given', () => {
    const { getByTestId, getByLabelText, queryByRole } = withTheme(
      <TextField label="Details" leadingIcon="create-outline" multiline />,
    );
    expect(getByTestId('icon-create-outline')).toBeTruthy();
    expect(getByLabelText('Details').tagName).toBe('TEXTAREA');
    expect(queryByRole('alert')).toBeNull();
  });
});
