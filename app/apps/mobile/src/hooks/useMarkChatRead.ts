import { useEffect, useMemo } from 'react';
import { container } from '../lib/container';
import { reportHandledError } from '../lib/observability/reportHandledError';
import { useChatStore, type OptimisticMessage } from '../store/chatStore';

/** Keep server read acknowledgement ahead of local read state; contain RPC rejection. */
export function useMarkChatRead(messages: OptimisticMessage[], chatId: string, userId: string) {
  const unreadIncoming = useMemo(
    () => messages.some((m) => m.senderId !== userId && m.status !== 'read'),
    [messages, userId],
  );
  useEffect(() => {
    if (!unreadIncoming) return;
    void (async () => {
      await container.markChatRead.execute({ chatId, userId });
      useChatStore.getState().markChatLocallyRead(chatId);
    })().catch((error: unknown) => {
      // Keep unread state on failure. No automatic retry loop or false read receipt.
      reportHandledError(error, 'manual', ['chat', 'mark-read']);
    });
  }, [unreadIncoming, chatId, userId]);
}
