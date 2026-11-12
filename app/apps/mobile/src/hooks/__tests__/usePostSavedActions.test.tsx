// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
const m = vi.hoisted(() => ({ isSaved: vi.fn(), save: vi.fn(), unsave: vi.fn(), toast: vi.fn(), haptic: vi.fn(), userId: 'u1' as string | null }));
vi.mock('../../services/savedPostsComposition', () => ({ getIsPostSavedUseCase: () => ({ execute: m.isSaved }), getSavePostUseCase: () => ({ execute: m.save }), getUnsavePostUseCase: () => ({ execute: m.unsave }) }));
vi.mock('../../store/authStore', () => ({ useAuthStore: (sel: (state: { session: { userId: string } | null }) => unknown) => sel({ session: m.userId ? { userId: m.userId } : null }) }));
vi.mock('../../store/feedSessionStore', () => ({ useFeedSessionStore: { getState: () => ({ showEphemeralToast: m.toast }) } }));
vi.mock('../../lib/haptics', () => ({ hapticLightImpact: m.haptic }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
import { usePostSavedActions } from '../usePostSavedActions';
describe('usePostSavedActions', () => {
  let client: QueryClient;
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  beforeEach(() => { vi.clearAllMocks(); m.userId = 'u1'; client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
  it('saves optimistically, then confirms and reports success', async () => {
    m.isSaved.mockResolvedValue(false); m.save.mockResolvedValue(undefined);
    const { result } = renderHook(() => usePostSavedActions('p1'), { wrapper });
    await waitFor(() => expect(result.current.isSaved).toBe(false));
    await act(async () => result.current.toggleSave());
    expect(m.save).toHaveBeenCalledWith('p1'); expect(m.haptic).toHaveBeenCalled();
    expect(m.toast).toHaveBeenCalledWith('post.saveSuccess', 'success');
  });
  it('restores the previous value after save failure', async () => {
    m.isSaved.mockResolvedValue(false); m.save.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => usePostSavedActions('p2'), { wrapper });
    await waitFor(() => expect(result.current.isSaved).toBe(false));
    await act(async () => result.current.toggleSave());
    expect(result.current.isSaved).toBe(false);
    expect(m.toast).toHaveBeenCalledWith('post.saveError', 'error', 2800);
  });
  it('unsaves a saved post and invalidates saved-post and post-saved caches', async () => {
    m.isSaved.mockResolvedValueOnce(true).mockResolvedValue(false); m.unsave.mockResolvedValue(undefined);
    const { result } = renderHook(() => usePostSavedActions('p3'), { wrapper });
    await waitFor(() => expect(result.current.isSaved).toBe(true));
    m.isSaved.mockResolvedValue(false);
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await act(async () => result.current.toggleSave());
    expect(m.unsave).toHaveBeenCalledWith('p3'); await waitFor(() => expect(result.current.isSaved).toBe(false));
    expect(m.toast).toHaveBeenCalledWith('post.unsaveSuccess', 'success');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['post-saved', 'p3'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['saved-posts', 'u1'] });
  });
  it('restores saved=true after unsave failure and reports an error toast', async () => {
    m.isSaved.mockResolvedValue(true); m.unsave.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => usePostSavedActions('p4'), { wrapper });
    await waitFor(() => expect(result.current.isSaved).toBe(true));
    await act(async () => result.current.toggleSave());
    expect(result.current.isSaved).toBe(true); expect(m.toast).toHaveBeenCalledWith('post.unsaveError', 'error', 2800);
  });
  it('sends no saved-state lookup while disabled, and one once enabled (one request per opened menu, not per card)', async () => {
    m.isSaved.mockResolvedValue(true);
    const { result, rerender } = renderHook(({ enabled }) => usePostSavedActions('p5', { enabled }), { wrapper, initialProps: { enabled: false } });
    await new Promise((r) => setTimeout(r, 20));
    expect(m.isSaved).not.toHaveBeenCalled();
    expect(result.current.isSaved).toBe(false);
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.isSaved).toBe(true));
    expect(m.isSaved).toHaveBeenCalledTimes(1);
  });
  it('reports not-saved for a guest without a saved-state lookup', async () => {
    m.userId = null;
    const { result } = renderHook(() => usePostSavedActions('guest-post'), { wrapper });
    expect(result.current.isSaved).toBe(false);
    expect(result.current.busy).toBe(false);
  });
});
