import { describe, expect, it } from 'vitest';
import { activityLabelKey } from '../activityLabelKey';

describe('activityLabelKey', () => {
  it('words a closed volunteering post and its marks as volunteering (#2078)', () => {
    expect(activityLabelKey({ kind: 'post_closed_delivered', worldSlug: 'time' }))
      .toBe('stats.activityKindTime.post_closed_delivered');
    expect(activityLabelKey({ kind: 'marked_as_recipient', worldSlug: 'time' }))
      .toBe('stats.activityKindTime.marked_as_recipient');
    expect(activityLabelKey({ kind: 'unmarked_as_recipient', worldSlug: 'time' }))
      .toBe('stats.activityKindTime.unmarked_as_recipient');
  });

  it('keeps the shared wording for other volunteering rows and for every other world', () => {
    expect(activityLabelKey({ kind: 'post_created', worldSlug: 'time' })).toBe('stats.activityKind.post_created');
    expect(activityLabelKey({ kind: 'post_closed_delivered', worldSlug: 'items' }))
      .toBe('stats.activityKind.post_closed_delivered');
    expect(activityLabelKey({ kind: 'post_closed_delivered', worldSlug: null }))
      .toBe('stats.activityKind.post_closed_delivered');
  });
});
