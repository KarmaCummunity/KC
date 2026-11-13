import { allowsMove } from '../fsm/machine';
import { postSeriesMachine } from '../fsm/machines/postSeries';

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
    pause: allowsMove(postSeriesMachine, status, 'paused'),
    resume: allowsMove(postSeriesMachine, status, 'active'),
    end: allowsMove(postSeriesMachine, status, 'ended'),
  };
}
