// TD-148 / FR-CHAT-015 AC4-AC6 — display text for a chat message.
// The post-closure trigger (migration 0031) stores a Hebrew `body` plus a
// structured `system_payload`; the payload decides the localized text so the
// UI language wins. Every other message keeps its stored body.
import type { Message } from '@kc/domain';
import type { TFunction } from 'i18next';

type PostClosedPayload = { kind?: string; status?: string; recipient_user_id?: string | null };

function postClosedKey(payload: PostClosedPayload): string {
  if (payload.status !== 'closed_delivered') return 'chat.systemPostClosed.closedNotDelivered';
  return payload.recipient_user_id ? 'chat.systemPostClosed.deliveredToYou' : 'chat.systemPostClosed.deliveredToOther';
}

export function systemMessageText(message: Message, t: TFunction): string {
  const payload = message.systemPayload as PostClosedPayload | null;
  if (message.kind === 'system' && payload?.kind === 'post_closed') return t(postClosedKey(payload));
  return message.body ?? '';
}
