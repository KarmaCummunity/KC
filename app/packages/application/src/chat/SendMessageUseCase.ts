/** FR-CHAT-002 AC5, FR-CHAT-003 — validate body length, forward to repo. */
import { MESSAGE_MAX_CHARS } from '@kc/domain';
import type { Message } from '@kc/domain';
import type { IChatRepository } from '../ports/IChatRepository';
import { ChatError } from './errors';

export interface SendMessageInput {
  chatId: string;
  senderId: string;
  body: string;
  clientId?: string;
}

export class SendMessageUseCase {
  constructor(private readonly repo: IChatRepository) {}

  async execute(input: SendMessageInput): Promise<Message> {
    const trimmed = input.body.trim();
    if (trimmed.length === 0) {
      throw new ChatError('message_body_required', 'message_body_required');
    }
    if (trimmed.length > MESSAGE_MAX_CHARS) {
      throw new ChatError(
        'message_too_long',
        `message_too_long (>${MESSAGE_MAX_CHARS})`,
      );
    }
    if (input.clientId !== undefined) {
      return this.repo.sendMessage(input.chatId, input.senderId, trimmed, input.clientId);
    }
    return this.repo.sendMessage(input.chatId, input.senderId, trimmed);
  }
}
