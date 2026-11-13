// FR-CHAT-016 (PM decision 2026-11-11): a chat the member removed from their inbox never comes
// back with its history. The server starts the member's history at the removal (migration
// 0028_chat_fresh_thread.sql); this drops what the device still holds of the thread, so that
// contacting the same member again opens a clean thread at once, before any refetch.
import { useChatStore } from '../store/chatStore';

export function forgetHiddenChat(chatId: string): void {
  const store = useChatStore.getState();
  store.stopThreadSub(chatId);
  store.setThreadMessages(chatId, []);
}
