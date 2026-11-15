// FR-CHAT-002 / FR-CHAT-003 / FR-NOTIF-015 AC1 — chat-send orchestration
// extracted from `app/chat/[id].tsx` so the screen stays under the LOC cap
// (TD-140). Pure logic: optimistic insert, RPC call, reconciliation, +
// first-send push-pre-prompt + send-to-deleted-user feedback.
import { useRef } from 'react';
import { randomUUID } from 'expo-crypto';
import { MESSAGE_MAX_CHARS } from '@kc/domain';
import { ChatError } from '@kc/application';
import { useChatStore, type OptimisticMessage } from '../store/chatStore';
import i18n from '../i18n';
import { container } from '../lib/container';

/** Locale keys of the notice each send refusal that the member can act on shows (FR-CHAT-003). */
const SEND_FAILURE_NOTICES: Partial<Record<ChatError['code'], { title: string; message: string }>> = {
  send_to_deleted_user: { title: 'errors.chat.userUnavailableTitle', message: 'errors.chat.userUnavailableMessage' },
  rate_limited: { title: 'chat.messaging.rateLimited.title', message: 'chat.messaging.rateLimited.message' },
  blocked_relationship: { title: 'chat.messaging.blocked.title', message: 'chat.messaging.blocked.message' },
};

/** The translated notice for a failed send, or null when the failure only needs the red retry state. */
function sendFailureNotice(code: ChatError['code']): { title: string; message: string } | null {
  const keys = SEND_FAILURE_NOTICES[code];
  return keys ? { title: i18n.t(keys.title), message: i18n.t(keys.message) } : null;
}

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
    try {
      const server = await container.sendMessage.execute({ chatId, senderId: userId, body, messageId: clientId });
      useChatStore.getState().reconcileSent(chatId, clientId, server);
      if (wasFirstSend) void presentPrePrompt('first-message-sent');
    } catch (err) {
      useChatStore.getState().markFailed(chatId, clientId);
      const notice = err instanceof ChatError ? sendFailureNotice(err.code) : null;
      if (notice) setNotify(notice);
    }
  };
}
