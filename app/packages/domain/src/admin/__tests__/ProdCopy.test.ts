import { describe, expect, it } from 'vitest';
import { hasProdCopyData, type ProdCopyStatus } from '../ProdCopy';

const EMPTY: ProdCopyStatus = { members: 0, posts: 0, organizations: 0, follows: 0, savedPosts: 0, lastCopiedAt: null };

describe('ProdCopy (FR-ADMIN-037 AC13)', () => {
  it('there is copied data to delete when a copied member or organization exists', () => {
    expect(hasProdCopyData(EMPTY)).toBe(false);
    expect(hasProdCopyData({ ...EMPTY, members: 1 })).toBe(true);
    expect(hasProdCopyData({ ...EMPTY, organizations: 1 })).toBe(true);
    // Posts, follows and saves hang on copied members, so they never exist alone.
    expect(hasProdCopyData({ ...EMPTY, lastCopiedAt: '2026-11-21T20:45:00Z' })).toBe(false);
  });
});
