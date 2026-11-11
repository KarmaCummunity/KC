// FR-CHAT-002 / FR-CHAT-003 / FR-NOTIF-015 AC1 — chat-send orchestration
// extracted from `app/chat/[id].tsx` so the screen stays under the LOC cap
// (TD-140). Pure logic: optimistic insert, RPC call, reconciliation, +
// first-send push-pre-prompt + send-to-deleted-user feedback.
import { useRef } from 'react';
import { randomUUID } from 'expo-crypto';
import { MESSAGE_MAX_CHARS } from '@kc/domain';
import { ChatError } from '@kc/application';
import { useChatStore, type OptimisticMessage } from '../store/chatStore';
import { useNetworkStatusStore } from '../lib/networkStatusStore';
import { useOutboxStore } from '../store/outboxStore';
import i18n from '../i18n';
import { container } from '../lib/container';

interface UseChatSendArgs {
  chatId: string;
  userId: string;
  /** Composer value — used when the call site doesn't pass an override body. */
  input: string;
  /** Clears the composer after a successful optimistic insert. */
  setInput: (value: string) => void;
  /** Fires the push-permission pre-prompt after the user's very first send. */
  presentPrePrompt: (trigger: 'first-message-sent') => void;
  /** Surfaces typed `ChatError.send_to_deleted_user` feedback via the screen's NotifyModal. */
  setNotify: (notify: { title: string; message: string } | null) => void;
}

export function useChatSend({
  chatId,
  userId,
  input,
  setInput,
  presentPrePrompt,
  setNotify,
}: UseChatSendArgs) {
  const checkedFirstSendRef = useRef(false);

  return async function send(overrideClientId?: string, overrideBody?: string): Promise<void> {
    const body = (overrideBody ?? input).trim();
    if (body.length === 0 || body.length > MESSAGE_MAX_CHARS) return;
    // FR-NOTIF-015 AC1: capture first-send state before inserting the message.
    let wasFirstSend = false;
    if (!checkedFirstSendRef.current && userId) {
      checkedFirstSendRef.current = true;
      try {
        const hasSent = await container.chatRepo.hasSentAnyMessage(userId);
        if (!hasSent) wasFirstSend = true;
      } catch {
        /* non-critical — skip gate on error */
      }
    }
    const clientId = overrideClientId ?? randomUUID();
    const optimistic: OptimisticMessage = {
      messageId: clientId,
      clientId,
      chatId,
      senderId: userId,
      kind: 'user',
      body,
      systemPayload: null,
      mediaPayload: null,
      status: 'pending',
      createdAt: new Date().toISOString(),
      deliveredAt: null,
      readAt: null,
    };
    if (!overrideClientId) {
      useChatStore.getState().appendOptimistic(chatId, optimistic);
      setInput('');
    }
    const isOnline = useNetworkStatusStore.getState().isOnline;
    if (!isOnline) {
      useOutboxStore.getState().enqueue({
        entityType: 'chat_message',
        action: 'send_message',
        payload: { chatId, senderId: userId, body, clientId },
        idempotencyKey: `chat:${chatId}:${clientId}`,
      });
      return;
    }
    try {
      const server = await container.sendMessage.execute({ chatId, senderId: userId, body, clientId });
      useChatStore.getState().reconcileSent(chatId, clientId, server);
      if (wasFirstSend) void presentPrePrompt('first-message-sent');
    } catch (err) {
      useChatStore.getState().markFailed(chatId, clientId);
      if (err instanceof ChatError && err.code === 'send_to_deleted_user') {
        setNotify({ title: i18n.t('errors.chat.userUnavailableTitle'), message: i18n.t('errors.chat.userUnavailableMessage') });
      } else {
        useOutboxStore.getState().enqueue({
          entityType: 'chat_message',
          action: 'send_message',
          payload: { chatId, senderId: userId, body, clientId },
          idempotencyKey: `chat:${chatId}:${clientId}`,
        });
      }
    }
  };
}
