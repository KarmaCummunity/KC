/** FR-CHAT-004 AC1 + FR-CHAT-006 — locates or creates the chat. First-anchor-wins. A ride or a listing is a post, so one post anchor covers them. */
import type { Chat } from '@kc/domain';
import type { IChatRepository } from '../ports/IChatRepository';

export interface OpenOrCreateChatInput {
  viewerId: string;
  otherUserId: string;
  anchorPostId?: string;
  /** When true, always insert a new non-support chat row (after personal hide). */
  preferNewThread?: boolean;
}

export class OpenOrCreateChatUseCase {
  constructor(private readonly repo: IChatRepository) {}

  async execute(input: OpenOrCreateChatInput): Promise<Chat> {
    return this.repo.findOrCreateChat(
      input.viewerId,
      input.otherUserId,
      { postId: input.anchorPostId },
      { preferNewThread: input.preferNewThread },
    );
  }
}
