// @vitest-environment jsdom
// FR-AUTH-010 AC2.d — the three-part date field reports an ISO date only for a real calendar date
// and shows the 18+ rule inline.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';

vi.mock('react-native-reanimated', async () => (await import('../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('react-native-safe-area-context', async () => (await import('../ui/__tests__/kitDialogTestKit')).safeAreaDouble);
vi.mock('react-i18next', async () => (await import('../ui/__tests__/kitDialogTestKit')).i18nDouble);
vi.mock('@expo/vector-icons', async () => (await import('../ui/__tests__/kitDialogTestKit')).iconsDouble);

import { renderInTheme } from '../ui/__tests__/kitDialogTestKit';
import { DateOfBirthField } from '../DateOfBirthField';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('DateOfBirthField', () => {
  it('reports null until all three parts are typed, then the ISO date', () => {
    const onChange = vi.fn();
    renderInTheme(<DateOfBirthField value={null} onChange={onChange} />);
    type('dateOfBirth.day', '5');
    type('dateOfBirth.month', '3');
    expect(onChange).toHaveBeenLastCalledWith(null);
    type('dateOfBirth.year', '1990');
    expect(onChange).toHaveBeenLastCalledWith('1990-03-05');
  });

  it('reports null for a date that does not exist and says it is not valid', () => {
    const onChange = vi.fn();
    renderInTheme(<DateOfBirthField value={null} onChange={onChange} />);
    type('dateOfBirth.day', '31');
    type('dateOfBirth.month', '4');
    type('dateOfBirth.year', '1990');
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByText('dateOfBirth.errors.invalid')).toBeTruthy();
  });

  it('says the 18+ rule inline for a young date, and keeps only digits', () => {
    const onChange = vi.fn();
    const year = new Date().getFullYear() - 10;
    const { rerender } = renderInTheme(<DateOfBirthField value={null} onChange={onChange} />);
    type('dateOfBirth.day', '1a');
    type('dateOfBirth.month', '1');
    type('dateOfBirth.year', String(year));
    expect((screen.getByLabelText('dateOfBirth.day') as HTMLInputElement).value).toBe('1');
    expect(onChange).toHaveBeenLastCalledWith(`${year}-01-01`);
    rerender(<DateOfBirthField value={`${year}-01-01`} onChange={onChange} />);
    expect(screen.getByText('dateOfBirth.errors.underage')).toBeTruthy();
  });

  it('shows the privacy helper when nothing is wrong', () => {
    renderInTheme(<DateOfBirthField value={null} onChange={vi.fn()} />);
    expect(screen.getByText('dateOfBirth.helper')).toBeTruthy();
  });
});
