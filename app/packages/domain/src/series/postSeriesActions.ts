import { canTransition } from '../fsm/machine';
import { postSeriesMachine } from '../fsm/machines/postSeries';
import type { PostSeriesStatus } from './PostSeries';

/** The actions the owner's series list offers on one series (FR-POST-024 AC7–AC8). */
export interface PostSeriesActions {
  readonly pause: boolean;
  readonly resume: boolean;
  readonly end: boolean;
}

/**
 * Derives a series' actions from `postSeriesMachine`, so the list offers what the RPC accepts:
 * pause an active series, resume a paused one, end either. An ended series, or a status the app
 * does not know (a newer server), offers nothing.
 */
export function postSeriesActions(status: string): PostSeriesActions {
  return {
    pause: isMove(status, 'paused'),
    resume: isMove(status, 'active'),
    end: isMove(status, 'ended'),
  };
}

/** True only for a real edge out of `status` (a same-status write is not an action). */
function isMove(status: string, to: PostSeriesStatus): boolean {
  const answer = canTransition(postSeriesMachine, status, to);
  return answer.ok && answer.changed;
}
