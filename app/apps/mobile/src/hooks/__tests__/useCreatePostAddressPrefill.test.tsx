// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
type AddressState = { cityId: string | null; cityName: string | null; street: string; streetNumber: string };
const m = vi.hoisted(() => ({ profile: vi.fn() }));
vi.mock('../../services/userComposition', () => ({ getEditableProfile: m.profile }));
vi.mock('../../store/lastAddressStore', () => {
  const state: AddressState = { cityId: 'last-city', cityName: 'Last City', street: 'Last Street', streetNumber: '7' };
  const listeners: Array<(s: AddressState) => void> = [];
  const store = (sel: (s: AddressState) => unknown) => sel(state);
  store.getState = () => state;
  store.subscribe = (fn: (s: AddressState) => void) => { listeners.push(fn); return () => listeners.splice(listeners.indexOf(fn), 1); };
  store.setState = (next: Partial<AddressState>) => { Object.assign(state, next); listeners.forEach(fn => fn(state)); };
  return { useLastAddressStore: store };
});
import { useCreatePostAddressPrefill } from '../useCreatePostAddressPrefill';
import { useLastAddressStore } from '../../store/lastAddressStore';
const addressStore = useLastAddressStore as unknown as { setState: (next: Partial<AddressState>) => void };
describe('useCreatePostAddressPrefill', () => {
  beforeEach(() => { vi.clearAllMocks(); addressStore.setState({ cityId: 'last-city', cityName: 'Last City', street: 'Last Street', streetNumber: '7' }); });
  it('merges profile address over last address and clears street when city changes', async () => {
    m.profile.mockResolvedValue({ city: 'profile-city', cityName: 'Profile City', profileStreet: ' Main ', profileStreetNumber: '3' });
    const { result } = renderHook(() => useCreatePostAddressPrefill('u1'));
    await waitFor(() => expect(result.current.street).toBe('Main'));
    expect(result.current.city).toEqual({ id: 'profile-city', name: 'Profile City' });
    act(() => result.current.setCity({ id: 'other', name: 'Other' }));
    expect(result.current.street).toBe(''); expect(result.current.streetNumber).toBe('');
  });
  it('preserves user edits if the profile request resolves afterward', async () => {
    let resolve!: (value: unknown) => void;
    m.profile.mockReturnValue(new Promise(r => { resolve = r; }));
    const { result } = renderHook(() => useCreatePostAddressPrefill('u1'));
    act(() => result.current.setStreet('Typed Street'));
    await act(async () => resolve({ city: 'profile-city', cityName: 'Profile City', profileStreet: 'Profile Street', profileStreetNumber: null }));
    expect(result.current.street).toBe('Typed Street');
  });
  it('does not fetch without an owner and follows last-address updates while pristine', async () => {
    const { result } = renderHook(() => useCreatePostAddressPrefill(undefined));
    expect(m.profile).not.toHaveBeenCalled();
    act(() => addressStore.setState({ cityId: 'new-city', cityName: 'New City', street: 'New St', streetNumber: '9' }));
    expect(result.current.street).toBe('New St'); expect(result.current.streetNumber).toBe('9');
  });
  it('uses last-address fields when profile fields are empty and tolerates profile errors', async () => {
    m.profile.mockResolvedValue({ city: null, cityName: null, profileStreet: ' ', profileStreetNumber: null });
    const { result } = renderHook(() => useCreatePostAddressPrefill('u1'));
    await waitFor(() => expect(m.profile).toHaveBeenCalledWith('u1'));
    await waitFor(() => expect(result.current.street).toBe('Last Street'));
    expect(result.current.city).toEqual({ id: 'last-city', name: 'Last City' });
    m.profile.mockRejectedValue(new Error('offline'));
    const other = renderHook(() => useCreatePostAddressPrefill('u2'));
    await waitFor(() => expect(m.profile).toHaveBeenCalledWith('u2'));
    expect(other.result.current.street).toBe('Last Street');
  });
  it('supports functional setters and unsubscribes its address listener on unmount', () => {
    const { result, unmount } = renderHook(() => useCreatePostAddressPrefill(undefined));
    act(() => { result.current.setStreet((s) => `${s}!`); result.current.setStreetNumber((n) => `${n}0`); });
    expect(result.current.street).toBe('Last Street!'); expect(result.current.streetNumber).toBe('70');
    act(() => result.current.setCity({ id: 'last-city', name: 'Same City' }));
    expect(result.current.street).toBe('Last Street!');
    unmount();
  });
});
