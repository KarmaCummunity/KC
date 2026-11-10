import { canTransition } from '../fsm/machine';
import { standingOrderMachine } from '../fsm/machines/standingOrder';
import type { StandingOrderStatus } from './PaymentTypes';

/** The actions the donor's standing-order list offers on one order. */
export interface StandingOrderActions {
  readonly pause: boolean;
  readonly resume: boolean;
  readonly cancel: boolean;
}

/**
 * Derives an order's actions from `standingOrderMachine`, so the list offers what the RPCs
 * accept: pause an active order, resume a paused one, cancel either. A status the app does not
 * know (a newer server) offers nothing.
 */
export function standingOrderActions(status: string): StandingOrderActions {
  return {
    pause: isMove(status, 'paused'),
    resume: isMove(status, 'active'),
    cancel: isMove(status, 'cancelled'),
  };
}

/** True only for a real edge out of `status` (a same-status write is not an action). */
function isMove(status: string, to: StandingOrderStatus): boolean {
  const answer = canTransition(standingOrderMachine, status, to);
  return answer.ok && answer.changed;
}
