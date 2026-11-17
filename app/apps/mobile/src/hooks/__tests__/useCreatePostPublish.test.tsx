// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const { execute, countOpenByUser, back, track, activation, haptic, invalidateProfile, invalidatePersonal } = vi.hoisted(() => ({
  execute: vi.fn(), countOpenByUser: vi.fn(), back: vi.fn(), track: vi.fn(), activation: vi.fn(), haptic: vi.fn(), invalidateProfile: vi.fn(), invalidatePersonal: vi.fn(),
}));
vi.mock('../../services/postsComposition', () => ({ getCreatePostUseCase: () => ({ execute }), getPostRepo: () => ({ countOpenByUser }) }));
vi.mock('expo-router', () => ({ useRouter: () => ({ back, canGoBack: () => true, dismissTo: vi.fn() }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, values?: { message?: string }) => values ? `${key}:${values.message}` : key }) }));
vi.mock('../../i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('../../lib/analyticsCoreLoop', () => ({ trackCoreLoop: track, trackActivationIfFirst: activation }));
vi.mock('../../lib/haptics', () => ({ hapticLightImpact: () => undefined, hapticSuccess: haptic }));
vi.mock('../../lib/invalidateMyProfilePostQueries', () => ({ invalidateMyProfilePostQueries: invalidateProfile }));
vi.mock('../../lib/invalidatePersonalStatsCaches', () => ({ invalidatePersonalStatsCaches: invalidatePersonal }));
vi.mock('../../store/authStore', () => ({ useAuthStore: { getState: () => ({ session: null }) } }));

import { useCreatePostPublish } from '../useCreatePostPublish';

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{children}</QueryClientProvider>;
type PublishArgs = Parameters<typeof useCreatePostPublish>[0];
const baseArgs = (): PublishArgs => ({
  ownerId: 'u1', type: 'Give', title: 'Title', description: 'Description', category: 'furniture' as unknown as PublishArgs['category'],
  city: { id: 'city-1', name: 'City' }, street: 'Main', streetNumber: '2', locationDisplayLevel: 'FullAddress',
  condition: 'Good', isGive: false, urgency: '', estimatedValue: 0, uploads: [], hideFromCounterparty: false,
  visibilityRef: { current: 'Public' }, setPublishFollowersOpen: vi.fn(), requestSoftGate: vi.fn((fn: () => void) => fn()),
  uploadingCount: 0, presentPrePrompt: vi.fn(),
});

beforeEach(() => { vi.clearAllMocks(); execute.mockResolvedValue({ postId: 'p1' }); countOpenByUser.mockResolvedValue(2); });

describe('useCreatePostPublish', () => {
  it('validates required fields, upload state, and followers confirmation before mutation', () => {
    const args = baseArgs();
    args.city = null;
    const { result, rerender } = renderHook(({ props }) => useCreatePostPublish(props), { wrapper, initialProps: { props: args } });
    act(() => result.current.tryPublish());
    expect(result.current.addressInlineMessage).not.toBeNull();
    expect(args.requestSoftGate).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    args.city = { id: 'city-1', name: 'City' };
    args.visibilityRef.current = 'FollowersOnly';
    rerender({ props: args });
    act(() => result.current.tryPublish());
    expect(args.setPublishFollowersOpen).toHaveBeenCalledWith(true);
  });

  it('publishes after soft gate and performs success effects with exact payload', async () => {
    const args = baseArgs();
    args.uploads = [{ uri: 'file:///image.png', mimeType: 'image/png' } as never];
    const { result } = renderHook(() => useCreatePostPublish(args), { wrapper });
    act(() => result.current.tryPublish());
    await waitFor(() => expect(execute).toHaveBeenCalled());
    await waitFor(() => expect(back).toHaveBeenCalledOnce());
    expect(countOpenByUser).toHaveBeenCalledWith('u1');
    expect(track).toHaveBeenCalledWith('listing_created', { world: 'items', cityId: 'city-1' });
    expect(haptic).toHaveBeenCalled();
  });

  it('closes the form without waiting for the cache refetches to finish', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    // A refetch that never settles: the exit must not depend on it.
    vi.spyOn(client, 'invalidateQueries').mockReturnValue(new Promise<void>(() => {}));
    const pendingWrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useCreatePostPublish(baseArgs()), { wrapper: pendingWrapper });
    act(() => result.current.tryPublish());
    await waitFor(() => expect(back).toHaveBeenCalledOnce());
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['feed'] });
  });

  it('shows a failure toast for rejected publishing and prevents publishing during uploads', async () => {
    const args = baseArgs();
    args.uploadingCount = 1;
    const { result, rerender } = renderHook(({ props }) => useCreatePostPublish(props), { wrapper, initialProps: { props: args } });
    expect(result.current.isPublishing).toBe(true);
    act(() => result.current.tryPublish());
    expect(args.requestSoftGate).not.toHaveBeenCalled();
    args.uploadingCount = 0;
    rerender({ props: args });
    execute.mockRejectedValueOnce(new Error('network'));
    act(() => result.current.tryPublish());
    await waitFor(() => expect(execute).toHaveBeenCalled());
    expect(back).not.toHaveBeenCalled();
  });

  // FR-RESP-006 AC27 — a rejected Publish marks every missing field inline and bumps the jump signal.
  it('marks a missing title and photo inline only after a rejected Publish, and counts each rejection', () => {
    const args = baseArgs();
    args.title = '   ';
    args.isGive = true;
    args.uploads = [];
    const { result } = renderHook(() => useCreatePostPublish(args), { wrapper });
    expect(result.current.titleInlineMessage).toBeNull();
    expect(result.current.photoInlineMessage).toBeNull();
    expect(result.current.failedSubmitCount).toBe(0);

    act(() => result.current.tryPublish());
    expect(result.current.titleInlineMessage).toBe('createPostValidation.missingTitle');
    expect(result.current.photoInlineMessage).toBe('createPostValidation.missingPhoto');
    expect(result.current.failedSubmitCount).toBe(1);

    // Same errors, second press: the counter still moves so the form scrolls to the problem again.
    act(() => result.current.tryPublish());
    expect(result.current.failedSubmitCount).toBe(2);
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not require a photo on a request post', () => {
    const args = baseArgs();
    args.isGive = false;
    args.uploads = [];
    const { result } = renderHook(() => useCreatePostPublish(args), { wrapper });
    act(() => result.current.tryPublish());
    expect(result.current.photoInlineMessage).toBeNull();
    expect(result.current.failedSubmitCount).toBe(0);
  });
});
