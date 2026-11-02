// @vitest-environment jsdom
// Onboarding steps on the kit buttons (FR-AUTH-010 / 011 / 012 / 018, spec 17 §4.1.1, TD-243):
// each step's call to action moves the flow on and keeps its disabled / busy rules.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type React from 'react';
import { cleanup, fireEvent } from '@testing-library/react';

const router = { back: vi.fn(), push: vi.fn(), replace: vi.fn() };
const basicInfo = {
  displayName: '', setDisplayName: vi.fn(), city: null, setCity: vi.fn(), street: '', setStreet: vi.fn(),
  streetNumber: '', setStreetNumber: vi.fn(), contactPhone: '', setContactPhone: vi.fn(),
  loading: false, hasRequiredFields: true, canSubmit: true,
  handleBack: vi.fn(), handleContinue: vi.fn(), handleSkip: vi.fn(),
};
const photo = {
  session: null, avatarUrl: null, hasAvatar: false, uploading: false, finalizing: false, busy: false,
  pick: vi.fn(), remove: vi.fn(), finalize: vi.fn(), goBack: vi.fn(),
};

vi.mock('react-native-reanimated', async () => (await import('../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('@expo/vector-icons', async () => (await import('../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('react-i18next', async () => (await import('../ui/__tests__/kitDialogTestKit')).i18nDouble);
vi.mock('react-native-safe-area-context', async () => (await import('../ui/__tests__/kitDialogTestKit')).safeAreaDouble);
vi.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('expo-router', () => ({ useRouter: () => router }));
// Motion wrappers and the pickers are not under test: render children as they are.
vi.mock('../animations/AnimatedEntry', () => ({ AnimatedEntry: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('../animations/HeroHalo', () => ({ HeroHalo: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('../animations/TourSlidePager', () => ({ TourSlidePager: () => null }));
vi.mock('../OnboardingStepHeader', () => ({ OnboardingStepHeader: () => null }));
vi.mock('../CityPicker', () => ({ CityPicker: () => null }));
vi.mock('../StreetPicker', () => ({ StreetPicker: () => null }));
vi.mock('../PhotoSourceSheet', () => ({ PhotoSourceSheet: () => null }));
vi.mock('../AvatarInitials', () => ({ AvatarInitials: () => null }));
vi.mock('../../hooks/useOnboardingBasicInfoFlow', () => ({ useOnboardingBasicInfoFlow: () => basicInfo }));
vi.mock('../../hooks/useOnboardingPhotoFlow', () => ({ useOnboardingPhotoFlow: () => photo }));

import AboutIntroScreen from '../../../app/(onboarding)/about-intro';
import BasicInfoScreen from '../../../app/(onboarding)/basic-info';
import PhotoScreen from '../../../app/(onboarding)/photo';
import TourScreen from '../../../app/(onboarding)/tour';
import { renderInTheme } from '../ui/__tests__/kitDialogTestKit';

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(basicInfo, { loading: false, hasRequiredFields: true });
  Object.assign(photo, { hasAvatar: false, finalizing: false, busy: false });
});
afterEach(cleanup);

describe('onboarding calls to action', () => {
  it('step 1 continues to the basic info step', () => {
    const { getByRole } = renderInTheme(<AboutIntroScreen />);
    fireEvent.click(getByRole('button', { name: 'onboarding.aboutIntroCta' }));
    expect(router.replace).toHaveBeenCalledWith('/(onboarding)/basic-info');
  });

  it('step 2 continues once the required fields are filled', () => {
    const { getByRole } = renderInTheme(<BasicInfoScreen />);
    fireEvent.click(getByRole('button', { name: 'onboarding.continueA11y' }));
    expect(basicInfo.handleContinue).toHaveBeenCalledTimes(1);
  });

  it('step 2 holds the call to action without the required fields and while saving', () => {
    basicInfo.hasRequiredFields = false;
    const { getByRole, unmount } = renderInTheme(<BasicInfoScreen />);
    const blocked = getByRole('button', { name: 'onboarding.continueA11y' });
    expect(blocked.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(blocked);
    expect(basicInfo.handleContinue).not.toHaveBeenCalled();
    unmount();

    Object.assign(basicInfo, { hasRequiredFields: true, loading: true });
    const saving = renderInTheme(<BasicInfoScreen />).getByRole('button', { name: 'onboarding.continueA11y' });
    expect(saving.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(saving);
    expect(basicInfo.handleContinue).not.toHaveBeenCalled();
  });

  it('step 3 finishes from its primary action and is busy while finishing', () => {
    const { getByRole, unmount } = renderInTheme(<PhotoScreen />);
    fireEvent.click(getByRole('button', { name: 'onboarding.photoContinueWithoutCta' }));
    expect(photo.finalize).toHaveBeenCalledTimes(1);
    unmount();

    Object.assign(photo, { finalizing: true, busy: true });
    const busy = renderInTheme(<PhotoScreen />).getByRole('button', { name: 'onboarding.photoContinueWithoutCta' });
    expect(busy.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(busy);
    expect(photo.finalize).toHaveBeenCalledTimes(1);
  });

  it('step 3 holds the photo picker while an upload runs', () => {
    Object.assign(photo, { hasAvatar: true, busy: true });
    const { getByRole } = renderInTheme(<PhotoScreen />);
    const replace = getByRole('button', { name: 'onboarding.photoReplaceCta' });
    expect(replace.getAttribute('aria-disabled')).toBe('true');
    expect(getByRole('button', { name: 'onboarding.photoContinueWithCta' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('step 4 steps through the slides, then enters the app', () => {
    const { getByRole } = renderInTheme(<TourScreen />);
    fireEvent.click(getByRole('button', { name: 'onboarding.tourNextCta' }));
    fireEvent.click(getByRole('button', { name: 'onboarding.tourNextCta' }));
    expect(router.replace).not.toHaveBeenCalled();
    fireEvent.click(getByRole('button', { name: 'onboarding.tourLetsStartCta' }));
    expect(router.replace).toHaveBeenCalledWith('/(tabs)');
  });
});
