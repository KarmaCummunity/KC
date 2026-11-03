// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const location = vi.hoisted(() => ({
  request: vi.fn(), getPermission: vi.fn(), getPosition: vi.fn(),
  accuracy: { Balanced: 3 },
}));
vi.mock('expo-location', () => ({
  Accuracy: location.accuracy,
  requestForegroundPermissionsAsync: location.request,
  getForegroundPermissionsAsync: location.getPermission,
  getCurrentPositionAsync: location.getPosition,
}));

import { useMyLocation } from '../useMyLocation';

beforeEach(() => {
  location.request.mockResolvedValue({ status: 'granted' });
  location.getPermission.mockResolvedValue({ status: 'denied' });
  location.getPosition.mockResolvedValue({ coords: { latitude: 31.7, longitude: 35.2 } });
});
afterEach(() => vi.clearAllMocks());

describe('useMyLocation', () => {
  it('silently reads the initial position only when permission is already granted', async () => {
    location.getPermission.mockResolvedValue({ status: 'granted' });
    const { result } = renderHook(() => useMyLocation());
    await waitFor(() => expect(result.current.initial).toEqual({ lat: 31.7, lng: 35.2 }));
    expect(location.getPosition).toHaveBeenCalledWith({ accuracy: location.accuracy.Balanced });
    expect(result.current.status).toBe('granted');
  });

  it('does not read initial position without permission and ignores permission read errors', async () => {
    const denied = renderHook(() => useMyLocation());
    await waitFor(() => expect(location.getPermission).toHaveBeenCalledTimes(1));
    expect(denied.result.current.initial).toBeNull();
    expect(location.getPosition).not.toHaveBeenCalled();
    denied.unmount();

    location.getPermission.mockRejectedValueOnce(new Error('offline'));
    const failure = renderHook(() => useMyLocation());
    await waitFor(() => expect(location.getPermission).toHaveBeenCalledTimes(2));
    expect(failure.result.current.initial).toBeNull();
    expect(failure.result.current.status).toBe('idle');
  });

  it('locates after permission, returning coordinates and updating status', async () => {
    const { result } = renderHook(() => useMyLocation());
    let coords: { lat: number; lng: number } | null = null;
    await act(async () => { coords = await result.current.locate(); });
    expect(location.request).toHaveBeenCalledTimes(1);
    expect(coords).toEqual({ lat: 31.7, lng: 35.2 });
    expect(result.current.coords).toEqual(coords);
    expect(result.current.status).toBe('granted');
  });

  it('returns null for denied permission and position failures with matching status', async () => {
    const { result, rerender } = renderHook(() => useMyLocation());
    location.request.mockResolvedValue({ status: 'denied' });
    let coords: { lat: number; lng: number } | null = null;
    await act(async () => { coords = await result.current.locate(); });
    expect(coords).toBeNull();
    expect(result.current.status).toBe('denied');
    expect(location.getPosition).not.toHaveBeenCalled();

    location.request.mockResolvedValue({ status: 'granted' });
    location.getPosition.mockRejectedValue(new Error('gps unavailable'));
    rerender();
    await act(async () => { coords = await result.current.locate(); });
    expect(coords).toBeNull();
    expect(result.current.status).toBe('error');
  });

  it('prevents an initial async position result from updating state after unmount', async () => {
    let finishPosition: ((value: { coords: { latitude: number; longitude: number } }) => void) | undefined;
    location.getPermission.mockResolvedValue({ status: 'granted' });
    location.getPosition.mockImplementation(() => new Promise((resolve) => { finishPosition = resolve; }));
    const { result, unmount } = renderHook(() => useMyLocation());
    await waitFor(() => expect(finishPosition).toBeDefined());
    unmount();
    await act(async () => finishPosition?.({ coords: { latitude: 1, longitude: 2 } }));
    expect(result.current.initial).toBeNull();
  });
});
