import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/authSecureStorage', () => ({ pickAuthStorage: () => undefined }));

const { useChatStore } = await import('../../store/chatStore');
const { forgetHiddenChat } = await import('../forgetHiddenChat');

describe('forgetHiddenChat (FR-CHAT-016)', () => {
  beforeEach(() => {
    useChatStore.setState({ threads: {}, threadSubs: {} });
  });

  it('drops the cached messages and the live subscription of the removed chat only', () => {
    const unsubscribe = vi.fn();
    useChatStore.setState({
      threads: {
        c1: [{ messageId: 'm1' } as never],
        c2: [{ messageId: 'm2' } as never],
      },
      threadSubs: { c1: unsubscribe },
    });

    forgetHiddenChat('c1');

    const state = useChatStore.getState();
    expect(state.threads.c1).toEqual([]);
    expect(state.threads.c2).toHaveLength(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(state.threadSubs.c1).toBeUndefined();
  });
});
