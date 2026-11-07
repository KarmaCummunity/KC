import { describe, expect, it } from 'vitest';
import { buildFeedListEntries } from '../feedListLayout';

function post(id: string) {
  return { postId: id } as import('@kc/application').PostWithOwner;
}

describe('buildFeedListEntries', () => {
  it('returns no rows when there are no posts (so feed empty state can render)', () => {
    expect(buildFeedListEntries([], 16)).toEqual([]);
  });

  it('inserts a matches row every N posts', () => {
    const posts = Array.from({ length: 20 }, (_, i) => post(`p${i}`));
    const entries = buildFeedListEntries(posts, 16);
    const matches = entries.filter((e) => e.kind === 'matches');
    expect(matches).toHaveLength(1);
    expect(matches[0].key).toBe('matches-after-16');
  });
});
