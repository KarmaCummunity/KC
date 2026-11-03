// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { state, replace, complete, skip, toast, setOnboarding, setSkipped } = vi.hoisted(() => ({
  state: { session: { userId: 'u1', displayName: 'Name' } as { userId: string; displayName?: string } | null },
  replace: vi.fn(), complete: vi.fn(), skip: vi.fn(), toast: vi.fn(), setOnboarding: vi.fn(), setSkipped: vi.fn(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../lib/editProfileSaveErrors', () => ({ mapEditProfileSaveError: (key: string) => key }));
vi.mock('../../lib/profileAddressFieldGate', () => ({ getProfileAddressPairIssue: (street: string, number: string) => Boolean(street) !== Boolean(number) ? 'addressPairInvalid' : null }));
vi.mock('expo-router', () => ({ useRouter: () => ({ replace }) }));
vi.mock('../../store/authStore', () => ({ useAuthStore: Object.assign((selector: (s: { session: typeof state.session; setOnboardingState: typeof setOnboarding }) => unknown) => selector({ session: state.session, setOnboardingState: setOnboarding }), { getState: () => ({ setBasicInfoSkipped: setSkipped }) }) }));
vi.mock('../../store/feedSessionStore', () => ({ useFeedSessionStore: { getState: () => ({ showEphemeralToast: toast }) } }));
vi.mock('../../services/userComposition', () => ({ getCompleteBasicInfoUseCase: () => ({ execute: complete }), markBasicInfoSkipped: skip }));
import { useOnboardingBasicInfoFlow } from '../useOnboardingBasicInfoFlow';
describe('useOnboardingBasicInfoFlow', () => {
  beforeEach(() => { vi.clearAllMocks(); state.session = { userId: 'u1', displayName: 'Name' }; complete.mockResolvedValue(undefined); skip.mockResolvedValue(undefined); });
  it('validates missing name and address pairs and resets address on city changes', async () => {
    const { result } = renderHook(() => useOnboardingBasicInfoFlow());
    expect(result.current.hasRequiredFields).toBe(false);
    await act(() => result.current.handleContinue());
    expect(toast).toHaveBeenCalledWith('onboarding.fillNameAndCity', 'error', 2500);
    act(() => { result.current.setDisplayName(' Name '); result.current.setCity({ id: 'c1', name: 'Town' }); result.current.setStreet('Main'); result.current.setDateOfBirth('1990-05-15'); });
    await act(() => result.current.handleContinue());
    expect(result.current.canSubmit).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(expect.any(String), 'error', 2800);
    act(() => result.current.setStreetNumber('4'));
    act(() => result.current.setCity({ id: 'c2', name: 'Other' }));
    expect(result.current.street).toBe('');
    expect(result.current.streetNumber).toBe('');
    expect(result.current.canSubmit).toBe(true);
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
  it('does not save, and the button stays disabled, without a valid adult date of birth (FR-AUTH-010 AC2.d)', async () => {
    const { result } = renderHook(() => useOnboardingBasicInfoFlow());
    act(() => { result.current.setCity({ id: 'c1', name: 'Town' }); });
    expect(result.current.hasRequiredFields).toBe(false);
    await act(() => result.current.handleContinue());
    expect(complete).not.toHaveBeenCalled();
    act(() => result.current.setDateOfBirth('2015-01-01'));
    expect(result.current.hasRequiredFields).toBe(false);
    act(() => result.current.setDateOfBirth('1990-05-15'));
    expect(result.current.hasRequiredFields).toBe(true);
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
});
