import { describe, expect, it } from 'vitest';
import { BackendRuleError, PostSeriesError } from '@kc/domain';
import { postSeriesErrorKey } from '../postSeriesError';

describe('postSeriesErrorKey (FR-POST-024)', () => {
  it('names a schedule problem found before the round trip', () => {
    expect(postSeriesErrorKey(new PostSeriesError('series_weekdays_required', 'x'))).toBe('postSeries.errors.weekdaysRequired');
    expect(postSeriesErrorKey(new PostSeriesError('series_ends_in_past', 'x'))).toBe('postSeries.errors.endsInPast');
  });

  it('names the server refusals of a series', () => {
    const refusal = (reason: string) => postSeriesErrorKey(new BackendRuleError(reason, 'rpc:set_post_series_status'));
    expect(refusal('illegal_transition')).toBe('postSeries.errors.ended');
    expect(refusal('post_series_no_occurrence')).toBe('postSeries.errors.noOccurrence');
    expect(refusal('post_series_date_started')).toBe('postSeries.errors.occurrenceStarted');
    expect(refusal('forbidden')).toBe('postSeries.errors.orgRequired');
  });

  it('leaves any other error to the caller', () => {
    expect(postSeriesErrorKey(new BackendRuleError('post_limit_exceeded', 'rpc:x'))).toBeNull();
    expect(postSeriesErrorKey(new Error('boom'))).toBeNull();
  });
});
