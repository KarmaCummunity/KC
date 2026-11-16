// @vitest-environment jsdom
// NFR-PERF-005 (#2344): one own-profile read is five requests, so every hook that needs a field
// of the signed-in member's profile must read the shared ['user-profile', id] query.
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findById: vi.fn() }));
vi.mock('../../services/userComposition', () => ({ getUserRepo: () => ({ findById: mocks.findById }) }));
vi.mock('../../lib/container', () => ({
  container: { userRepo: { findById: mocks.findById }, updateNotificationPreferences: { execute: vi.fn() } },
}));
vi.mock('../../store/authStore', () => {
  const state = { session: { userId: 'u1' } };
  const useAuthStore = (selector: (s: typeof state) => unknown) => selector(state);
  useAuthStore.getState = () => state;
  return { useAuthStore };
});

import { useDateOfBirthRequirement } from '../useDateOfBirthRequirement';
import { useNotificationPreferences } from '../useNotificationPreferences';
import { useViewerVerificationLevel } from '../useViewerVerificationLevel';

const quietHours = { enabled: false, start: '22:00', end: '07:00', timezone: 'UTC' };
const profile = { verificationLevel: 2, dateOfBirth: null, notificationPreferences: { critical: true, social: false, quietHours } };

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.findById.mockResolvedValue(profile);
});
afterEach(() => { client.clear(); vi.clearAllMocks(); });

describe('own-profile readers', () => {
  it('perform a single profile read when they mount together', async () => {
    const { result } = renderHook(
      () => ({ prefs: useNotificationPreferences(), level: useViewerVerificationLevel(), dob: useDateOfBirthRequirement() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.prefs.prefs.social).toBe(false));
    await waitFor(() => expect(result.current.level.isSuccess).toBe(true));
    await expect(result.current.dob.isDateOfBirthMissing()).resolves.toBe(true);
    expect(mocks.findById).toHaveBeenCalledTimes(1);
  });

  it('answer the date-of-birth check from a profile another screen already loaded', async () => {
    client.setQueryData(['user-profile', 'u1'], { ...profile, dateOfBirth: '1990-01-01' });
    const { result } = renderHook(() => useDateOfBirthRequirement(), { wrapper });
    await expect(result.current.isDateOfBirthMissing()).resolves.toBe(false);
    expect(mocks.findById).not.toHaveBeenCalled();
  });

  it('re-read the profile after the date of birth is saved', async () => {
    const { result } = renderHook(() => useDateOfBirthRequirement(), { wrapper });
    await expect(result.current.isDateOfBirthMissing()).resolves.toBe(true);
    mocks.findById.mockResolvedValue({ ...profile, dateOfBirth: '1990-01-01' });
    result.current.forgetDateOfBirthAnswer();
    await expect(result.current.isDateOfBirthMissing()).resolves.toBe(false);
  });
});
