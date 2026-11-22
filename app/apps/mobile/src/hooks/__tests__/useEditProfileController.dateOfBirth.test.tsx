// @vitest-environment jsdom
// FR-PROFILE-007 AC7 — the member's own date of birth on Edit Profile: the stored value is loaded
// into the form, and a change is saved under the 18+ rule of FR-AUTH-010 AC2.d or not at all.
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { back, findById, getProfile, setDateOfBirth, updateProfile, reconcile, invalidate } = vi.hoisted(() => ({
  back: vi.fn(), findById: vi.fn(), getProfile: vi.fn(), setDateOfBirth: vi.fn(), updateProfile: vi.fn(),
  reconcile: vi.fn(), invalidate: vi.fn(),
}));

// One `t` for every render: the controller reloads the profile when `t` changes.
vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
vi.mock('expo-router', () => ({ useRouter: () => ({ back }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: invalidate }) }));
vi.mock('../../lib/editProfileSaveErrors', () => ({ mapEditProfileSaveError: (code: string) => `mapped:${code}` }));
vi.mock('../../services/avatarUpload', () => ({ removeUploadedAvatar: vi.fn() }));
vi.mock('../../store/authStore', () => ({ useAuthStore: { getState: () => ({ setOnboardingState: vi.fn() }) } }));
vi.mock('../../services/userComposition', () => ({
  getEditableProfile: getProfile,
  getUserRepo: () => ({ findById }),
  getSetDateOfBirthUseCase: () => ({ execute: setDateOfBirth }),
  getUpdateProfileUseCase: () => ({ execute: updateProfile }),
  getReconcileDeferredBasicInfoUseCase: () => ({ execute: reconcile }),
}));

import type { AuthSession } from '@kc/application';
import { useEditProfileController } from '../useEditProfileController';

const session = { userId: 'u1', displayName: 'Dana', avatarUrl: null } as unknown as AuthSession;
const STORED = '1990-05-15';
/** A date ten years back: a real calendar date that the 18+ rule refuses. */
const CHILD = `${new Date().getFullYear() - 10}-01-01`;

/** The loaded form of a member whose profile is complete and whose date of birth is `stored`. */
async function loadedForm(stored: string | null = STORED) {
  findById.mockResolvedValue({ dateOfBirth: stored });
  const setSession = vi.fn();
  const hook = renderHook(() => useEditProfileController(session, setSession));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return { ...hook, setSession };
}

describe('useEditProfileController — date of birth (FR-PROFILE-007 AC7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProfile.mockResolvedValue({
      displayName: 'Dana', city: 'c1', cityName: 'Town', profileStreet: null, profileStreetNumber: null,
      contactPhone: null, biography: null, avatarUrl: null,
    });
    setDateOfBirth.mockResolvedValue(undefined);
    updateProfile.mockResolvedValue(undefined);
    reconcile.mockResolvedValue(null);
  });

  it("loads the member's own stored date and starts clean", async () => {
    const { result } = await loadedForm();
    expect(findById).toHaveBeenCalledWith('u1');
    expect(result.current.dateOfBirth).toBe(STORED);
    expect(result.current.isDirty).toBe(false);
  });

  it('leaves the date alone when it did not change', async () => {
    const { result } = await loadedForm();
    act(() => result.current.setBiography('Hello'));
    await act(() => result.current.handleSave());
    expect(setDateOfBirth).not.toHaveBeenCalled();
    expect(updateProfile).toHaveBeenCalledTimes(1);
  });

  it('saves a changed adult date for this member, before the rest of the profile', async () => {
    const { result } = await loadedForm();
    act(() => result.current.setDateOfBirth('1988-02-29'));
    expect(result.current.isDirty).toBe(true);
    await act(() => result.current.handleSave());
    expect(setDateOfBirth).toHaveBeenCalledWith({ sessionUserId: 'u1', userId: 'u1', dateOfBirth: '1988-02-29' });
    expect(setDateOfBirth.mock.invocationCallOrder[0]).toBeLessThan(updateProfile.mock.invocationCallOrder[0]!);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('is clean again after a successful save, so the unsaved-changes guard stays quiet', async () => {
    getProfile.mockResolvedValue({
      displayName: 'Dana', city: 'c1', cityName: 'Town', profileStreet: null, profileStreetNumber: null,
      contactPhone: '050-7654321', biography: null, avatarUrl: null,
    });
    const { result } = await loadedForm();
    act(() => result.current.setContactPhone(''));
    expect(result.current.isDirty).toBe(true);
    await act(() => result.current.handleSave());
    expect(updateProfile).toHaveBeenCalledWith(expect.objectContaining({ contactPhone: null }));
    expect(back).toHaveBeenCalledTimes(1);
    expect(result.current.saving).toBe(false);
    expect(result.current.isDirty).toBe(false);
  });

  it('keeps an edit made while the save is in flight dirty (only the saved values become the baseline)', async () => {
    const { result } = await loadedForm();
    let release: () => void = () => undefined;
    updateProfile.mockReturnValueOnce(new Promise<void>((resolve) => { release = resolve; }));
    act(() => result.current.setBiography('Saved'));
    let pending: Promise<void> = Promise.resolve();
    act(() => { pending = result.current.handleSave(); });
    act(() => result.current.setBiography('Typed during save'));
    await act(async () => { release(); await pending; });
    expect(updateProfile).toHaveBeenCalledWith(expect.objectContaining({ biography: 'Saved' }));
    expect(result.current.isDirty).toBe(true);
  });

  it('stays dirty when the save fails, so the guard still protects the edit', async () => {
    const { result } = await loadedForm();
    updateProfile.mockRejectedValueOnce(new Error('boom'));
    act(() => result.current.setBiography('Hello'));
    await act(() => result.current.handleSave());
    expect(back).not.toHaveBeenCalled();
    expect(result.current.isDirty).toBe(true);
  });

  it('refuses an under-18 date under the field and saves nothing', async () => {
    const { result } = await loadedForm();
    act(() => { result.current.setDateOfBirth(CHILD); result.current.setBiography('Hello'); });
    await act(() => result.current.handleSave());
    expect(result.current.fieldErrors.dateOfBirth).toBe('dateOfBirth.errors.underage');
    expect(result.current.failedSubmitCount).toBe(1);
    expect(setDateOfBirth).not.toHaveBeenCalled();
    expect(updateProfile).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
  });

  it('refuses a date that is not a real one (the field reports null) and saves nothing', async () => {
    const { result } = await loadedForm();
    act(() => result.current.setDateOfBirth(null));
    await act(() => result.current.handleSave());
    expect(result.current.fieldErrors.dateOfBirth).toBe('dateOfBirth.errors.invalid');
    expect(setDateOfBirth).not.toHaveBeenCalled();
    expect(updateProfile).not.toHaveBeenCalled();
    // Fixing the date clears the message without another save.
    act(() => result.current.setDateOfBirth(STORED));
    expect(result.current.fieldErrors).toEqual({});
  });

  it('saves nothing else when the server refuses the date, and says why', async () => {
    const { result } = await loadedForm(null);
    setDateOfBirth.mockRejectedValueOnce(new Error('underage'));
    act(() => { result.current.setDateOfBirth('1990-01-01'); result.current.setBiography('Hello'); });
    await act(() => result.current.handleSave());
    expect(updateProfile).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    expect(result.current.notify).toEqual({ title: 'profile.editScreen.saveFailedTitle', message: 'mapped:underage' });
    expect(result.current.saving).toBe(false);
  });
});
