// A recurring time post (FR-POST-024, `docs/spec/requirements/04_posts.md`): the owner publishes a
// series once — weekdays, a local start time and duration, an optional end date — and the server
// publishes each upcoming date as an ordinary post (an "occurrence") that takes its own
// registrations. A date's post carries `details.post_series = { id, on }`.

/** Days ahead the server keeps a series' dates published (0744 `post_series_materialize`). */
export const POST_SERIES_LOOKAHEAD_DAYS = 30;

/** `ended` is final: the owner publishes a new series instead (FR-POST-024 AC8–AC9). */
export const POST_SERIES_STATUSES = ['active', 'paused', 'ended'] as const;
export type PostSeriesStatus = (typeof POST_SERIES_STATUSES)[number];
