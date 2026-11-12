// TD-148 / FR-CHAT-015 AC4-AC6 — display text for a chat message.
// The post-closure system message carries no body, only a structured `system_payload`
// (`kind`, `status`, `delivered_to_chat_member`); the payload decides the localized text so the
// UI language wins. Every other message keeps its stored body.
import type { Message } from '@kc/domain';
import type { TFunction } from 'i18next';

type PostClosedPayload = { kind?: string; status?: string; delivered_to_chat_member?: boolean };

function postClosedKey(payload: PostClosedPayload): string {
  if (payload.status !== 'closed_delivered') return 'chat.systemPostClosed.closedNotDelivered';
  // The post went to one of this chat's two members (not to somebody else): FR-CHAT-015 AC4 vs AC5.
  return payload.delivered_to_chat_member ? 'chat.systemPostClosed.deliveredToYou' : 'chat.systemPostClosed.deliveredToOther';
}

export function systemMessageText(message: Message, t: TFunction): string {
  const payload = message.systemPayload as PostClosedPayload | null;
  if (message.kind === 'system' && payload?.kind === 'post_closed') return t(postClosedKey(payload));
  return message.body ?? '';
}
