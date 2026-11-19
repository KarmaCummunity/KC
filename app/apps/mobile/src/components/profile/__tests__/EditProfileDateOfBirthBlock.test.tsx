// @vitest-environment jsdom
// FR-PROFILE-007 AC7 — the date of birth section of Edit Profile: it shows the member's stored
// date, reports a change as an ISO date, and carries the form's message under the field.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';

vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('react-native-safe-area-context', async () => (await import('../../ui/__tests__/kitDialogTestKit')).safeAreaDouble);
vi.mock('react-i18next', async () => (await import('../../ui/__tests__/kitDialogTestKit')).i18nDouble);
vi.mock('@expo/vector-icons', async () => (await import('../../ui/__tests__/kitDialogTestKit')).iconsDouble);

import { renderInTheme } from '../../ui/__tests__/kitDialogTestKit';
import { EditProfileDateOfBirthBlock } from '../EditProfileDateOfBirthBlock';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const part = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

describe('EditProfileDateOfBirthBlock', () => {
  it('shows the stored date in its three parts, with the privacy helper', () => {
    renderInTheme(<EditProfileDateOfBirthBlock value="1990-05-15" onChange={vi.fn()} />);
    expect(screen.getByTestId('edit-profile-dob')).toBeTruthy();
    expect(part('dateOfBirth.day').value).toBe('15');
    expect(part('dateOfBirth.month').value).toBe('5');
    expect(part('dateOfBirth.year').value).toBe('1990');
    expect(screen.getByText('dateOfBirth.helper')).toBeTruthy();
  });

  it('reports a changed date as an ISO date', () => {
    const onChange = vi.fn();
    renderInTheme(<EditProfileDateOfBirthBlock value="1990-05-15" onChange={onChange} />);
    fireEvent.change(part('dateOfBirth.year'), { target: { value: '1988' } });
    expect(onChange).toHaveBeenLastCalledWith('1988-05-15');
  });

  it('says the 18+ rule under the field as soon as a young date is typed', () => {
    const year = new Date().getFullYear() - 10;
    renderInTheme(<EditProfileDateOfBirthBlock value={`${year}-05-15`} onChange={vi.fn()} />);
    expect(screen.getByText('dateOfBirth.errors.underage')).toBeTruthy();
  });

  it("shows the form's own message, and locks the parts while saving", () => {
    renderInTheme(<EditProfileDateOfBirthBlock value={null} onChange={vi.fn()} disabled errorText="form message" />);
    expect(screen.getByText('form message')).toBeTruthy();
    expect(part('dateOfBirth.year').disabled || part('dateOfBirth.year').readOnly).toBe(true);
  });
});
