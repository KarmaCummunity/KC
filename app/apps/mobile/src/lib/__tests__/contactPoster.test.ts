import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Post } from '@kc/domain';

const mockPush = vi.fn();
const mockRouter = { push: mockPush };
const mockExecute = vi.fn();
const mockConsumePreferNewThread = vi.fn();

vi.mock('../i18n', () => ({
  default: {
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `[t:${key}|${JSON.stringify(params)}]` : `[t:${key}]`,
  },
}));

vi.mock('../container', () => ({
  container: {
    openOrCreateChat: {
      execute: (...args: unknown[]) => mockExecute(...args),
    },
  },
}));

vi.mock('../chatNavigationPrefs', () => ({
  consumePreferNewThread: (...args: unknown[]) => mockConsumePreferNewThread(...args),
}));

import { contactPoster } from '../contactPoster';

const samplePost = {
  postId: 'post-100',
  ownerId: 'owner-200',
  type: 'Give',
  status: 'open',
  title: '  Wooden Table  ',
  description: 'Nice table',
  category: 'Furniture',
} as unknown as Post;

describe('contactPoster', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('no-ops when viewerId is null', async () => {
    await contactPoster(null, samplePost, mockRouter as never);

    expect(mockConsumePreferNewThread).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('opens chat and pushes to chat route with prefilled message', async () => {
    mockConsumePreferNewThread.mockReturnValueOnce(true);
    mockExecute.mockResolvedValueOnce({ chatId: 'chat-999' });

    await contactPoster('viewer-1', samplePost, mockRouter as never);

    expect(mockConsumePreferNewThread).toHaveBeenCalledWith('owner-200');
    expect(mockExecute).toHaveBeenCalledWith({
      viewerId: 'viewer-1',
      otherUserId: 'owner-200',
      anchorPostId: 'post-100',
      preferNewThread: true,
    });
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/chat/[id]',
      params: {
        id: 'chat-999',
        prefill: expect.stringContaining('Wooden Table'),
      },
    });
  });
});
