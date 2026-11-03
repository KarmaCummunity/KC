// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const { getEditableProfile } = vi.hoisted(() => ({ getEditableProfile: vi.fn() }));
vi.mock('../../services/userComposition', () => ({ getEditableProfile }));

import { useCreatePostAddressPrefill } from '../useCreatePostAddressPrefill';
import { useLastAddressStore } from '../../store/lastAddressStore';

beforeEach(() => {
  vi.clearAllMocks();
  useLastAddressStore.setState({ cityId: 'last-city', cityName: 'Last City', street: 'Old Street', streetNumber: '4' });
});

describe('useCreatePostAddressPrefill', () => {
  it('merges profile values over the saved address and falls back for blank profile lines', async () => {
    getEditableProfile.mockResolvedValue({ city: 'profile-city', cityName: 'Profile City', profileStreet: '  Main  ', profileStreetNumber: ' ' });
    const { result } = renderHook(() => useCreatePostAddressPrefill('u1'));
    await waitFor(() => expect(result.current.city?.id).toBe('profile-city'));
    expect(result.current.street).toBe('Main');
    expect(result.current.streetNumber).toBe('4');
  });

  it('skips profile lookup without an owner, tracks edits, and resets street on city change', async () => {
    const { result } = renderHook(() => useCreatePostAddressPrefill(undefined));
    expect(getEditableProfile).not.toHaveBeenCalled();
    act(() => result.current.setCity({ id: 'new-city', name: 'New City' }));
    expect(result.current.street).toBe('');
    expect(result.current.streetNumber).toBe('');
    act(() => result.current.setStreet((street) => `${street}Typed`));
    act(() => useLastAddressStore.getState().setLastAddress({ cityId: 'other', cityName: 'Other', street: 'Changed', streetNumber: '9' }));
    expect(result.current.street).toBe('Typed');
  });

  it('ignores a profile response after cleanup and swallows lookup errors', async () => {
    let resolveProfile: ((value: { city: string; cityName: string; profileStreet: string; profileStreetNumber: string }) => void) | undefined;
    getEditableProfile.mockReturnValueOnce(new Promise((resolve) => { resolveProfile = resolve; }));
    const { unmount } = renderHook(() => useCreatePostAddressPrefill('u1'));
    unmount();
    resolveProfile?.({ city: 'c', cityName: 'City', profileStreet: 'Street', profileStreetNumber: '1' });
    getEditableProfile.mockRejectedValueOnce(new Error('offline'));
    expect(() => renderHook(() => useCreatePostAddressPrefill('u2'))).not.toThrow();
  });
});
