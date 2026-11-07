// @vitest-environment jsdom
// FR-AUTH-015 soft gate on the kit `Modal` (spec 17 §4.1.1, TD-243): the save
// stays disabled until the required fields are filled, saves the basic info,
// and the ✕ keeps the old "Cancel" name.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';

const { execute, setOnboardingState } = vi.hoisted(() => ({
  execute: vi.fn(async () => undefined),
  setOnboardingState: vi.fn(),
}));

vi.mock('react-native-reanimated', async () => (await import('../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('react-native-safe-area-context', async () => (await import('../ui/__tests__/kitDialogTestKit')).safeAreaDouble);
vi.mock('react-i18next', async () => (await import('../ui/__tests__/kitDialogTestKit')).i18nDouble);
vi.mock('@expo/vector-icons', async () => (await import('../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => false }));
vi.mock('../../store/authStore', () => {
  const state = { session: { userId: 'u-1', displayName: '' }, setOnboardingState };
  return { useAuthStore: (select: (s: typeof state) => unknown) => select(state) };
});
vi.mock('../../store/feedSessionStore', () => ({
  useFeedSessionStore: { getState: () => ({ showEphemeralToast: vi.fn() }) },
}));
vi.mock('../../lib/editProfileSaveErrors', () => ({ mapEditProfileSaveError: (raw: string) => raw }));
vi.mock('../../services/userComposition', () => ({ getCompleteBasicInfoUseCase: () => ({ execute }) }));
// The city picker is its own component; a button stands in for picking a city.
vi.mock('../EditProfileAddressBlock', () => ({
  EditProfileAddressBlock: ({ onCityChange }: { onCityChange: (city: { id: string; name: string }) => void }) => (
    <button type="button" onClick={() => onCityChange({ id: 'c-1', name: 'Haifa' })}>pick city</button>
  ),
}));

// The date of birth field is its own component; a button stands in for typing a valid adult date.
vi.mock('../DateOfBirthField', () => ({
  DateOfBirthField: ({ onChange }: { onChange: (iso: string | null) => void }) => (
    <button type="button" onClick={() => onChange('1990-05-15')}>pick date of birth</button>
  ),
}));

import { renderInTheme } from '../ui/__tests__/kitDialogTestKit';
import { OnboardingSoftGateModal } from '../OnboardingSoftGateModal';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderGate() {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  renderInTheme(<OnboardingSoftGateModal visible onClose={onClose} onSaved={onSaved} />);
  return { onClose, onSaved };
}

describe('OnboardingSoftGateModal', () => {
  it('saves the basic info once the name, city and date of birth are filled', async () => {
    const { onSaved } = renderGate();
    expect(screen.getByRole('dialog', { name: 'onboarding.softGateTitle' })).toBeTruthy();
    const save = screen.getByRole('button', { name: 'onboarding.saveAndContinue' });
    expect(save.getAttribute('aria-disabled')).toBe('true');

    fireEvent.change(screen.getByLabelText('onboarding.displayName'), { target: { value: 'Dana' } });
    fireEvent.click(screen.getByRole('button', { name: 'pick city' }));
    // Name and city alone are not enough: the date of birth is required (FR-AUTH-010 AC2.d).
    expect(screen.getByRole('button', { name: 'onboarding.saveAndContinue' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'pick date of birth' }));
    fireEvent.click(screen.getByRole('button', { name: 'onboarding.saveAndContinue' }));

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'Dana', cityId: 'c-1', cityName: 'Haifa', dateOfBirth: '1990-05-15' }),
    );
    expect(setOnboardingState).toHaveBeenCalledWith('pending_avatar');
  });

  it('closes from the ✕, which keeps the "Cancel" name', () => {
    const { onClose } = renderGate();
    fireEvent.click(screen.getByRole('button', { name: 'general.cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
