import { describe, expect, it } from 'vitest';
import { postShowsEngagementSection } from '../postEngagementVisible';

describe('postShowsEngagementSection', () => {
  it('allows open and closed_delivered posts', () => {
    expect(postShowsEngagementSection('open')).toBe(true);
    expect(postShowsEngagementSection('closed_delivered')).toBe(true);
  });

  it('disallows terminal lifecycle states', () => {
    expect(postShowsEngagementSection('expired')).toBe(false);
    expect(postShowsEngagementSection('removed_admin')).toBe(false);
    expect(postShowsEngagementSection('deleted_no_recipient')).toBe(false);
  });
});
