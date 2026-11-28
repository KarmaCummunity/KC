// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { EditPostForm } from '../useEditPostForm';
const { update, back } = vi.hoisted(() => ({ update: vi.fn(), back: vi.fn() }));
vi.mock('../../services/postsComposition', () => ({ getUpdatePostUseCase: () => ({ execute: update }) }));
vi.mock('../../services/postMessages', () => ({ mapPostErrorToHebrew: () => 'error' }));
vi.mock('../../lib/syncOwnerPostActorIdentity', () => ({ syncOwnerPostActorIdentity: vi.fn() }));
vi.mock('expo-router', () => ({ useRouter: () => ({ canGoBack: () => true, back }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import { useEditPostSave } from '../useEditPostSave';
afterEach(cleanup);
it('invalidates a fresh search snapshot before returning from a saved edit', async () => {
  const qc = new QueryClient();
  const key = ['universalSearch', 'fixture', {}, null];
  qc.setQueryData(key, { posts: [{ title: 'before' }] });
  update.mockResolvedValue({ title: 'after' });
  back.mockImplementation(() => expect(qc.getQueryState(key)?.isInvalidated).toBe(true));
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const form = { title: 'after', description: '', category: 'Other', city: { id: 'city', name: 'City' }, street: '', streetNumber: '', locationDisplayLevel: 'CityOnly', condition: 'Used', urgency: '', visibility: 'Public', uploads: [] } as unknown as EditPostForm;
  const { result } = renderHook(() => useEditPostSave({ postId: 'p1', viewerId: 'u1', post: { type: 'Give', ownerId: 'u1' }, form, hideFromCounterparty: false, onFailure: vi.fn() }), { wrapper });
  await act(async () => { await result.current.mutateAsync(); });
  await waitFor(() => expect(back).toHaveBeenCalledOnce());
  expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
});
