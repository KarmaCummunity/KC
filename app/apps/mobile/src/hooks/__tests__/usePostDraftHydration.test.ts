// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePostDraftStore } from '../../store/postDraftStore';
import { usePostDraftHydration } from '../usePostDraftHydration';

const draft = {
  ownerId: 'owner-1', updatedAt: 1, type: 'offer', title: 'Title', description: 'Description',
  category: 'other', condition: 'good', urgency: 'normal', estimatedValue: 0,
  locationDisplayLevel: 'city', visibility: 'public', hideFromCounterparty: false,
  uploads: [{ path: 'available', uri: 'file://a' }, { path: 'missing', uri: 'file://b' }],
} as never;

beforeEach(() => usePostDraftStore.setState({ draft: null }));

describe('usePostDraftHydration', () => {
  it('returns none without an owner or a matching draft', async () => {
    const noOwner = renderHook(() => usePostDraftHydration(undefined));
    await waitFor(() => expect(noOwner.result.current.status).toEqual({ phase: 'none' }));
    noOwner.unmount();
    usePostDraftStore.setState({ draft });
    const otherOwner = renderHook(() => usePostDraftHydration('owner-2'));
    await waitFor(() => expect(otherOwner.result.current.status).toEqual({ phase: 'none' }));
    expect(usePostDraftStore.getState().draft).toBeNull();
  });

  it('probes assets, preserves order and exposes the hydrated draft once', async () => {
    usePostDraftStore.setState({ draft });
    const probe = vi.fn(async (path: string) => path === 'available');
    const { result } = renderHook(() => usePostDraftHydration('owner-1', probe));
    await waitFor(() => expect(result.current.status.phase).toBe('ready'));
    if (result.current.status.phase !== 'ready') throw new Error('draft did not hydrate');
    expect(probe).toHaveBeenCalledTimes(2);
    expect(probe).toHaveBeenNthCalledWith(1, 'available');
    expect(probe).toHaveBeenNthCalledWith(2, 'missing');
    expect(result.current.status.draft.uploads.map((asset) => asset.missing)).toEqual([undefined, true]);
    expect(result.current.status.draft.missingCount).toBe(1);
    act(() => expect(result.current.continueWithDraft()).toEqual(result.current.status.phase === 'ready' ? result.current.status.draft : null));
    expect(result.current.status).toEqual({ phase: 'none' });
    expect(result.current.continueWithDraft()).toBeNull();
  });

  it('clears persisted state on startFresh and ignores probe results after unmount', async () => {
    usePostDraftStore.setState({ draft });
    let resolveProbe: ((available: boolean) => void) | undefined;
    const probe = vi.fn(() => new Promise<boolean>((resolve) => { resolveProbe = resolve; }));
    const pending = renderHook(() => usePostDraftHydration('owner-1', probe));
    await waitFor(() => expect(probe).toHaveBeenCalled());
    pending.unmount();
    await act(async () => { resolveProbe?.(true); });

    const fresh = renderHook(() => usePostDraftHydration(undefined));
    act(() => fresh.result.current.startFresh());
    expect(usePostDraftStore.getState().draft).toBeNull();
    expect(fresh.result.current.status).toEqual({ phase: 'none' });
  });
});
