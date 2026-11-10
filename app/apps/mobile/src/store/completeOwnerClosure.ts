import {
  getMarkAsDeliveredUseCase,
  getOwnerCompleteOfferUseCase,
} from '../services/postsComposition';

export type ClosureOutcome = 'closed' | 'assigned';

/** Social posts use the post closure. Listing offers use the assign RPC (0658). */
export async function completeOwnerClosure(input: {
  postId: string;
  ownerId: string;
  recipientUserId: string | null;
  offerAssign: boolean;
}): Promise<ClosureOutcome> {
  if (!input.offerAssign) {
    await getMarkAsDeliveredUseCase().execute({
      postId: input.postId,
      ownerId: input.ownerId,
      recipientUserId: input.recipientUserId,
    });
    return 'closed';
  }
  const result = await getOwnerCompleteOfferUseCase().execute({
    targetId: input.postId,
    ownerId: input.ownerId,
    recipientUserId: input.recipientUserId,
    mode: input.recipientUserId ? 'assign' : 'close_without',
  });
  return result.closed ? 'closed' : 'assigned';
}
