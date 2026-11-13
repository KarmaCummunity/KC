import { allowsMove, hasEdge } from '../fsm/machine';
import { givingHandoffMachine } from '../fsm/machines/givingHandoff';
import type { GivingHandoffStatus } from './givingHandoff';

/** The two members of a giving handoff: the post owner, and the member who reserved. */
export type GivingHandoffParty = 'owner' | 'recipient';

/** What one member may do with a handoff in its current status. */
export interface GivingHandoffActions {
  /** Approve a waiting request (`confirm_item_handoff`). */
  readonly confirm: boolean;
  /** Mark the item, meal or session as handed over (`mark_giving_handed_over`). */
  readonly complete: boolean;
  /** Decline the request or back out of the reservation (`cancel_giving_handoff`). */
  readonly cancel: boolean;
  /** Rate the other member: open once the hand-over happened. */
  readonly rate: boolean;
}

/**
 * True while the handoff is still on its way to a hand-over: it waits for the owner's answer
 * or is approved. A handed-over, cancelled or missed handoff, and a status the app does not
 * know (a newer server), is not live.
 */
export function isGivingHandoffLive(status: string | null | undefined): boolean {
  return status != null && hasEdge(givingHandoffMachine, status, 'handed_over');
}

/**
 * Derives a member's actions from `givingHandoffMachine`, so the app offers what the handoff
 * RPCs accept. Two rules narrow the graph to those RPCs:
 * - the hand-over button takes an approved handoff; the direct `reserved → handed_over` edge
 *   belongs to closing the post with its recipient, not to this button;
 * - cancelling is for a live handoff; undoing a completed hand-over (`handed_over → cancelled`)
 *   is the reopen flow of the post.
 */
export function givingHandoffActions(status: string, party: GivingHandoffParty): GivingHandoffActions {
  const may = (to: GivingHandoffStatus): boolean => allowsMove(givingHandoffMachine, status, to, party);
  // The request still waits for the owner's answer while the graph has a move to `confirmed`.
  const isWaiting = hasEdge(givingHandoffMachine, status, 'confirmed');
  return {
    confirm: may('confirmed'),
    complete: !isWaiting && may('handed_over'),
    cancel: isGivingHandoffLive(status) && may('cancelled'),
    rate: status === 'handed_over',
  };
}
