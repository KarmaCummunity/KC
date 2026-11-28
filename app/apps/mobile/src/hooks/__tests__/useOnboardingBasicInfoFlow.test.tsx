// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { state, replace, complete, skip, toast, setOnboarding, setSkipped } = vi.hoisted(() => ({
  state: { session: { userId: 'u1', displayName: 'Name' } as { userId: string; displayName?: string } | null },
  replace: vi.fn(), complete: vi.fn(), skip: vi.fn(), toast: vi.fn(), setOnboarding: vi.fn(), setSkipped: vi.fn(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../lib/editProfileSaveErrors', () => ({ mapEditProfileSaveError: (key: string) => key }));
vi.mock('expo-router', () => ({ useRouter: () => ({ replace }) }));
vi.mock('../../store/authStore', () => ({ useAuthStore: Object.assign((selector: (s: { session: typeof state.session; setOnboardingState: typeof setOnboarding }) => unknown) => selector({ session: state.session, setOnboardingState: setOnboarding }), { getState: () => ({ setBasicInfoSkipped: setSkipped }) }) }));
vi.mock('../../store/feedSessionStore', () => ({ useFeedSessionStore: { getState: () => ({ showEphemeralToast: toast }) } }));
vi.mock('../../services/userComposition', () => ({ getCompleteBasicInfoUseCase: () => ({ execute: complete }), markBasicInfoSkipped: skip }));
const measureMark = vi.hoisted(() => vi.fn((_name: string, work: () => Promise<unknown>) => work()));
vi.mock('../../lib/observability/perfMarks', () => ({ measureMark }));
import { useOnboardingBasicInfoFlow } from '../useOnboardingBasicInfoFlow';
import { useOnboardingReplayStore } from '../../store/onboardingReplayStore';
describe('useOnboardingBasicInfoFlow', () => {
  beforeEach(() => { vi.clearAllMocks(); state.session = { userId: 'u1', displayName: 'Name' }; complete.mockResolvedValue(undefined); skip.mockResolvedValue(undefined); });
  it('marks nothing before Continue, then each problem under its own field, with no toast', async () => {
    const { result } = renderHook(() => useOnboardingBasicInfoFlow());
    act(() => result.current.setDisplayName(''));
    expect(result.current.fieldErrors).toEqual({});
    await act(() => result.current.handleContinue());
    expect(complete).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(result.current.fieldErrors).toEqual({
      displayName: 'profile.editScreen.invalidNameMessage',
      address: 'profile.editScreen.missingCityMessage',
      dateOfBirth: 'dateOfBirth.errors.invalid',
    });
    expect(result.current.failedSubmitCount).toBe(1);
  });

  it('marks half an address on the address, clears it once fixed, and resets the street on a city change', async () => {
    const { result } = renderHook(() => useOnboardingBasicInfoFlow());
    act(() => { result.current.setDisplayName(' Name '); result.current.setCity({ id: 'c1', name: 'Town' }); result.current.setStreet('Main'); result.current.setDateOfBirth('1990-05-15'); });
    await act(() => result.current.handleContinue());
    expect(result.current.fieldErrors).toEqual({ address: 'profile.editScreen.incompleteAddressMessageNumber' });
    act(() => result.current.setStreetNumber('4'));
    expect(result.current.fieldErrors).toEqual({});
    act(() => result.current.setCity({ id: 'c2', name: 'Other' }));
    expect(result.current.street).toBe('');
    expect(result.current.streetNumber).toBe('');
  });
  it('saves complete info with exact arguments and navigates; maps failures', async () => {
    const { result } = renderHook(() => useOnboardingBasicInfoFlow());
    act(() => { result.current.setCity({ id: 'c1', name: 'Town' }); result.current.setDateOfBirth('1990-05-15'); result.current.setStreet('Main'); result.current.setStreetNumber('2'); result.current.setContactPhone('555'); });
    await act(() => result.current.handleContinue());
    expect(complete).toHaveBeenCalledWith({ sessionUserId: 'u1', userId: 'u1', displayName: 'Name', cityId: 'c1', cityName: 'Town', dateOfBirth: '1990-05-15', profileStreet: 'Main', profileStreetNumber: '2', contactPhone: '555' });
    expect(setOnboarding).toHaveBeenCalledWith('pending_avatar');
    expect(replace).toHaveBeenCalledWith('/(onboarding)/photo');
    complete.mockRejectedValueOnce(new Error('offline'));
    await act(() => result.current.handleContinue());
    expect(result.current.loading).toBe(false);
    expect(toast).toHaveBeenCalledWith(expect.any(String), 'error', 2800);
  });
  it('does not save without a valid adult date of birth (FR-AUTH-010 AC2.d), and says why under the date', async () => {
    const { result } = renderHook(() => useOnboardingBasicInfoFlow());
    act(() => { result.current.setCity({ id: 'c1', name: 'Town' }); result.current.setDateOfBirth('2015-01-01'); });
    await act(() => result.current.handleContinue());
    expect(complete).not.toHaveBeenCalled();
    expect(result.current.fieldErrors.dateOfBirth).toBe('dateOfBirth.errors.underage');
    act(() => result.current.setDateOfBirth('1990-05-15'));
    expect(result.current.fieldErrors).toEqual({});
    await act(() => result.current.handleContinue());
    expect(complete).toHaveBeenCalledTimes(1);
  });
  // #2579: the save and the skip are the network waits between tap and the photo step.
  it('times the save and the skip as their own marks', async () => {
    const { result } = renderHook(() => useOnboardingBasicInfoFlow());
    act(() => { result.current.setCity({ id: 'c1', name: 'Town' }); result.current.setDateOfBirth('1990-05-15'); });
    await act(() => result.current.handleContinue());
    await act(() => result.current.handleSkip());
    expect(measureMark.mock.calls.map((c) => c[0])).toEqual(['onboarding.basic_info_save', 'onboarding.basic_info_skip']);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(skip).toHaveBeenCalledWith('u1');
  });
  it('skips for active sessions, ignores absent sessions, and guards back while loading', async () => {
    const { result, rerender } = renderHook(() => useOnboardingBasicInfoFlow());
    state.session = null; rerender();
    await act(() => result.current.handleSkip());
    expect(skip).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    state.session = { userId: 'u1' }; rerender();
    await act(() => result.current.handleSkip());
    expect(skip).toHaveBeenCalledWith('u1');
    expect(setSkipped).toHaveBeenCalledWith(true);
    expect(replace).toHaveBeenCalledWith('/(onboarding)/photo');
    skip.mockImplementationOnce(() => new Promise<void>(() => undefined));
    act(() => { void result.current.handleSkip(); });
    act(() => result.current.handleBack());
    expect(replace).toHaveBeenCalledTimes(1);
  });
  it('shows a toast without saving when the session is missing and navigates back otherwise', async () => {
    const { result, rerender } = renderHook(() => useOnboardingBasicInfoFlow());
    state.session = null; rerender();
    await act(() => result.current.handleContinue());
    expect(toast).toHaveBeenCalledWith('onboarding.noActiveSession', 'error', 2500);
    state.session = { userId: 'u1' }; rerender();
    act(() => result.current.handleBack());
    expect(replace).toHaveBeenCalledWith('/(onboarding)/about-intro');
  });
  // FR-ADMIN-035 — an admin replay runs the same step without touching the profile.
  describe('admin replay (sandbox)', () => {
    beforeEach(() => useOnboardingReplayStore.getState().start());
    afterEach(() => useOnboardingReplayStore.getState().stop());

    it('validates like the real step, then moves on without saving', async () => {
      const { result } = renderHook(() => useOnboardingBasicInfoFlow());
      act(() => result.current.setDisplayName(''));
      await act(() => result.current.handleContinue());
      expect(result.current.fieldErrors.displayName).toBe('profile.editScreen.invalidNameMessage');
      expect(replace).not.toHaveBeenCalled();
      act(() => { result.current.setDisplayName('Name'); result.current.setCity({ id: 'c1', name: 'Town' }); result.current.setDateOfBirth('1990-05-15'); });
      await act(() => result.current.handleContinue());
      expect(complete).not.toHaveBeenCalled();
      expect(setOnboarding).not.toHaveBeenCalled();
      expect(replace).toHaveBeenCalledWith('/(onboarding)/photo');
    });

    it('skips without recording the skip', async () => {
      const { result } = renderHook(() => useOnboardingBasicInfoFlow());
      await act(() => result.current.handleSkip());
      expect(skip).not.toHaveBeenCalled();
      expect(setSkipped).not.toHaveBeenCalled();
      expect(replace).toHaveBeenCalledWith('/(onboarding)/photo');
    });
  });
});
