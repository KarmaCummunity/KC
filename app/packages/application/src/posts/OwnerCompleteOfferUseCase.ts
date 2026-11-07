/** FR-CLOSURE-011 — owner names who received an open offer, or closes with nobody named. */
import type { IPostRepository } from '../ports/IPostRepository';
import { PostError } from './errors';

export type OwnerOfferMode = 'assign' | 'close_without';

export interface OwnerCompleteOfferInput {
  targetId: string;
  ownerId: string;
  recipientUserId: string | null;
  mode: OwnerOfferMode;
}

export interface OwnerCompleteOfferOutput {
  closed: boolean;
}

export class OwnerCompleteOfferUseCase {
  constructor(private readonly repo: IPostRepository) {}

  async execute(input: OwnerCompleteOfferInput): Promise<OwnerCompleteOfferOutput> {
    if (input.mode === 'assign' && !input.recipientUserId) {
      throw new PostError('closure_recipient_not_in_chat', 'closure_recipient_not_in_chat');
    }
    if (input.mode === 'close_without' && input.recipientUserId) {
      throw new PostError('closure_wrong_status', 'closure_wrong_status');
    }
    if (input.recipientUserId !== null && input.recipientUserId === input.ownerId) {
      throw new PostError('closure_recipient_not_in_chat', 'closure_recipient_not_in_chat');
    }
    return this.repo.ownerCompleteOffer(input.targetId, input.recipientUserId, input.mode);
  }
}
