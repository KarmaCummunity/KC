// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PostWithOwner } from '@kc/application';
const mocks = vi.hoisted(() => ({ findById: vi.fn(), listIdentity: vi.fn(), update: vi.fn(), upsert: vi.fn(), toast: vi.fn() }));
vi.mock('../../services/userComposition', () => ({ getUserRepo: () => ({ findById: mocks.findById }) }));
vi.mock('../../services/postsComposition', () => ({ getListPostActorIdentityUseCase: () => ({ execute: mocks.listIdentity }), getUpdatePostUseCase: () => ({ execute: mocks.update }), getUpsertPostActorIdentityUseCase: () => ({ execute: mocks.upsert }) }));
vi.mock('../../services/postMessages', () => ({ mapPostErrorToHebrew: (code: string) => code }));
vi.mock('../../store/feedSessionStore', () => ({ useFeedSessionStore: { getState: () => ({ showEphemeralToast: mocks.toast }) } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: { message?: string }) => options?.message ? `${key}:${options.message}` : key }) }));
import { shouldShowPostExposureControls, usePostActorPrivacyModel } from '../usePostActorPrivacyModel';
const post = (patch: Partial<PostWithOwner> = {}) => ({ postId: 'p1', ownerId: 'u1', status: 'open', visibility: 'Public', recipient: null, ...patch }) as unknown as PostWithOwner;
let client: QueryClient;
function renderModel(value: PostWithOwner, viewer = 'u1') { const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>; return renderHook(() => usePostActorPrivacyModel(value, viewer), { wrapper }); }
beforeEach(() => { vi.clearAllMocks(); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); mocks.findById.mockResolvedValue({ privacyMode: 'Private' }); mocks.listIdentity.mockResolvedValue([]); mocks.update.mockResolvedValue(undefined); mocks.upsert.mockResolvedValue(undefined); });
afterEach(() => { cleanup(); client.clear(); });
describe('usePostActorPrivacyModel', () => {
 it('limits exposure controls to owners and marked delivered recipients', () => { expect(shouldShowPostExposureControls(null, post())).toBe(false); expect(shouldShowPostExposureControls('u2', post())).toBe(false); expect(shouldShowPostExposureControls('u1', post())).toBe(true); expect(shouldShowPostExposureControls('u2', post({ status: 'closed_delivered', recipient: { recipientUserId: 'u2' } as unknown as NonNullable<PostWithOwner['recipient']> }))).toBe(true); });
 it('updates open owner visibility and couples OnlyMe to a hidden identity', async () => { const { result } = renderModel(post()); await waitFor(() => expect(result.current.profilePrivacy).toBe('Private')); expect(result.current.isOpenOwner).toBe(true); act(() => result.current.onAudienceChange('OnlyMe')); await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ postId: 'p1', viewerId: 'u1', patch: { visibility: 'OnlyMe' } })); await waitFor(() => expect(mocks.upsert).toHaveBeenCalledWith({ postId: 'p1', userId: 'u1', surfaceVisibility: 'OnlyMe', hideFromCounterparty: true })); expect(result.current.audienceValue).toBe('Public'); expect(result.current.hide).toBe(true); expect(mocks.toast).not.toHaveBeenCalled(); });
 it('persists closed surface changes and hide toggles; OnlyMe forces hide', async () => { const { result } = renderModel(post({ ownerId: 'u2', status: 'closed_delivered', visibility: 'Public' })); await waitFor(() => expect(mocks.listIdentity).toHaveBeenCalled()); act(() => result.current.onAudienceChange('OnlyMe')); await waitFor(() => expect(mocks.upsert).toHaveBeenCalledWith({ postId: 'p1', userId: 'u1', surfaceVisibility: 'OnlyMe', hideFromCounterparty: true })); act(() => result.current.onHideChange(false)); await waitFor(() => expect(mocks.upsert).toHaveBeenLastCalledWith({ postId: 'p1', userId: 'u1', surfaceVisibility: 'OnlyMe', hideFromCounterparty: false })); expect(result.current.showCounterpartyRow).toBe(false); });
 it('reports mutation errors via toast and returns saving to false', async () => { mocks.update.mockRejectedValueOnce(new Error('offline')); const { result } = renderModel(post()); act(() => result.current.onAudienceChange('FollowersOnly')); await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('post.publishFailed:post.networkError', 'error')); await waitFor(() => expect(result.current.saving).toBe(false)); });
});
