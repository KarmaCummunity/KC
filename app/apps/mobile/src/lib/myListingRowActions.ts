// The buttons of one row of "My listings", read from the post machine through the domain
// helper, so a button is offered exactly when the server accepts the move (issue #2204).
import { isPostEnded, postOwnerActions } from '@kc/domain';

/** Which buttons a row of "My listings" shows. */
export interface MyListingRowActions {
  readonly edit: boolean;
  readonly pause: boolean;
  /** Close the listing as delivered / fulfilled. */
  readonly fulfill: boolean;
  readonly resume: boolean;
  readonly addPhotos: boolean;
  readonly delete: boolean;
}

/**
 * The buttons for a listing whose post is in `status`. Photos can be added while the post is
 * editable and also after it ended (the owner keeps its record complete).
 */
export function myListingRowActions(status: string): MyListingRowActions {
  const actions = postOwnerActions(status);
  return {
    edit: actions.edit,
    pause: actions.pause,
    fulfill: actions.close,
    resume: actions.resume,
    addPhotos: actions.edit || isPostEnded(status),
    delete: actions.delete,
  };
}
