// TD-110 bug 2 — inbox row preview text.
//
// Previously the preview rendered `lastMessage?.body ?? ''`, which produced:
//   - Empty string for chats with no messages yet (new conversation row added
//     when the auto-message use case is queued but no message has flushed).
//   - Raw body for system messages (`closure_owner_marked`, `auto_removed`,
//     `donation_link_reported`, etc.) — readable-only-to-the-developer text.
//
// The audit (TD-110) calls for a prefix on system messages so users see the
// kind (`chat.inboxSystemPrefix`, currently "(system message)" in Hebrew) and
// an explicit empty-conversation placeholder (`chat.inboxNewConversation`,
// currently "(new conversation)" in Hebrew).
import type { Message } from '@kc/domain';
import type { TFunction } from 'i18next';
import { systemMessageText } from './chat/systemMessageText';

const isSystemKind = (kind: string | undefined | null) => kind === 'system';

export function formatInboxPreview(
  lastMessage: Message | null | undefined,
  t: TFunction,
): string {
  if (!lastMessage) return t('chat.inboxNewConversation');
  const body = systemMessageText(lastMessage, t).trim();
  if (isSystemKind(lastMessage.kind)) {
    const prefix = t('chat.inboxSystemPrefix');
    return body ? `${prefix} ${body}` : prefix;
  }
  return body || t('chat.inboxNewConversation');
}
