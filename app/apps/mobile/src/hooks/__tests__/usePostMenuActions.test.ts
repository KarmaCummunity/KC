// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PostWithOwner } from '@kc/application';
import { usePostMenuActions } from '../usePostMenuActions';

const deleteMock = vi.fn();
const adminRemoveMock = vi.fn();
const toastMock = vi.fn();

vi.mock('../../lib/container', () => ({
  container: {
    deletePost: {
      execute: (...args: unknown[]) => deleteMock(...args),
    },
    adminRemovePost: {
      execute: (...args: unknown[]) => adminRemoveMock(...args),
    },
  },
}));

vi.mock('../../store/feedSessionStore', () => ({
  useFeedSessionStore: {
    getState: () => ({
      showEphemeralToast: toastMock,
    }),
  },
}));

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
    }),
  };
});

const mockPost = {
  postId: 'post-123',
  ownerId: 'owner-456',
} as unknown as PostWithOwner;

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children);

describe('usePostMenuActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  it('executes owner delete successfully', async () => {
    deleteMock.mockResolvedValue(undefined);
    queryClient.setQueryData(['universalSearch', 'fixture', {}, null], { posts: ['deleted-post'] });
    const onAfterRemoval = vi.fn();
    const onSettle = vi.fn();

    const { result } = renderHook(() =>
      usePostMenuActions({ post: mockPost, onAfterRemoval, onSettle }),
      { wrapper },
    );

    await act(async () => {
      await result.current.handleOwnerDelete();
    });

    expect(deleteMock).toHaveBeenCalledWith({
      postId: 'post-123',
      ownerId: 'owner-456',
    });
    expect(toastMock).toHaveBeenCalledWith('post.deleteSuccess', 'success');
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryState(['universalSearch', 'fixture', {}, null])?.isInvalidated).toBe(true);
    expect(onAfterRemoval).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('executes admin remove successfully', async () => {
    adminRemoveMock.mockResolvedValue(undefined);
    const onAfterRemoval = vi.fn();
    const onSettle = vi.fn();

    const { result } = renderHook(() =>
      usePostMenuActions({ post: mockPost, onAfterRemoval, onSettle }),
      { wrapper },
    );

    await act(async () => {
      await result.current.handleAdminRemove();
    });

    expect(adminRemoveMock).toHaveBeenCalledWith({
      postId: 'post-123',
    });
    expect(toastMock).toHaveBeenCalledWith('post.adminRemoveSuccess', 'success');
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onAfterRemoval).toHaveBeenCalledTimes(1);
  });

  it('handles error on delete and allows clearing error', async () => {
    deleteMock.mockRejectedValue(new Error('Network error'));
    const onAfterRemoval = vi.fn();
    const onSettle = vi.fn();

    const { result } = renderHook(() =>
      usePostMenuActions({ post: mockPost, onAfterRemoval, onSettle }),
      { wrapper },
    );

    await act(async () => {
      await result.current.handleOwnerDelete();
    });

    expect(result.current.error).toBe('post.deleteError');
    expect(onSettle).not.toHaveBeenCalled();
    expect(onAfterRemoval).not.toHaveBeenCalled();

    act(() => {
      result.current.clearError();
    });
    expect(result.current.error).toBeNull();
  });
});
