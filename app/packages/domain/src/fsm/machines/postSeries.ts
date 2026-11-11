import { POST_SERIES_STATUSES } from '../../series/PostSeries';
import { defineMachine } from '../machine';

/**
 * Recurring time post lifecycle (`post_series.status`; spec `docs/spec/requirements/04_posts.md`
 * FR-POST-024 AC7–AC9).
 *
 * - The owner pauses and resumes a series (`set_post_series_status`): a pause removes the
 *   upcoming dates nobody registered for, a resume publishes them again.
 * - Ending, from either state, is final: every upcoming date is cancelled and its registrants are
 *   told. The hourly sweep also ends a series whose last date has passed.
 *
 * SQL copy: `supabase/migrations/0744_post_series.sql`.
 */
export const postSeriesMachine = defineMachine({
  id: 'post_series',
  states: POST_SERIES_STATUSES,
  edges: [
    { from: 'active', to: 'paused' },
    { from: 'paused', to: 'active' },
    { from: 'active', to: 'ended' },
    { from: 'paused', to: 'ended' },
  ],
});
