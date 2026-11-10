// Dev-only "simulate hard refresh" (FR-CHAT-012 verification aid).
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { container } from '../lib/container';
import { useChatStore } from '../store/chatStore';

export function useSimulateHardRefresh(userId: string | undefined) {
  const queryClient = useQueryClient();
  const [hardRefreshing, setHardRefreshing] = useState(false);

  const simulateHardRefresh = async () => {
    if (!userId || hardRefreshing) return;
    setHardRefreshing(true);
    try {
      useChatStore.getState().resetOnSignOut();
      queryClient.clear();
      await useChatStore.getState().startInboxSub(userId, container.chatRepo, container.chatRealtime);
    } finally {
      setHardRefreshing(false);
    }
  };

  return { hardRefreshing, simulateHardRefresh };
}
