// #2568 — pure reducers of the chat store's message reactions.
import { describe, expect, it } from 'vitest';
import { withLoadedReactions, withNewMessages, withReactionChange } from '../chatStoreReactions';

describe('withLoadedReactions', () => {
  it('marks every read id as known, with its rows or none', () => {
    const next = withLoadedReactions(undefined, ['m1', 'm2'], [
      { messageId: 'm1', userId: 'a', reactionType: 'like' },
      { messageId: 'm1', userId: 'b', reactionType: 'love' },
    ]);
    expect(next).toEqual({ m1: { a: 'like', b: 'love' }, m2: {} });
  });

  it('keeps ids not in the read and ignores rows for ids not asked', () => {
    const next = withLoadedReactions({ m0: { a: 'sad' } }, ['m1'], [{ messageId: 'mX', userId: 'a', reactionType: 'like' }]);
    expect(next).toEqual({ m0: { a: 'sad' }, m1: {} });
  });
});

describe('withNewMessages', () => {
  it('adds new ids as known-empty and leaves known ones untouched', () => {
    const current = { m1: { a: 'like' as const } };
    expect(withNewMessages(current, ['m1', 'm2'])).toEqual({ m1: { a: 'like' }, m2: {} });
  });

  it('returns the same object when nothing is new', () => {
    const current = { m1: {} };
    expect(withNewMessages(current, ['m1', ''])).toBe(current);
  });
});

describe('withReactionChange', () => {
  const current = { m1: { a: 'like' as const, b: 'love' as const }, m2: {} };

  it('sets, changes and clears one member reaction, replacing only that message map', () => {
    const set = withReactionChange(current, { messageId: 'm2', userId: 'a', reactionType: 'laugh' });
    expect(set).toEqual({ ...current, m2: { a: 'laugh' } });
    expect(set?.m1).toBe(current.m1);

    expect(withReactionChange(current, { messageId: 'm1', userId: 'a', reactionType: 'sad' })?.m1).toEqual({ a: 'sad', b: 'love' });
    expect(withReactionChange(current, { messageId: 'm1', userId: 'a', reactionType: null })?.m1).toEqual({ b: 'love' });
  });

  it('is a no-op for an unchanged reaction, an unknown message or an unknown chat', () => {
    expect(withReactionChange(current, { messageId: 'm1', userId: 'a', reactionType: 'like' })).toBe(current);
    expect(withReactionChange(current, { messageId: 'mX', userId: 'a', reactionType: 'like' })).toBe(current);
    expect(withReactionChange(current, { messageId: 'm2', userId: 'a', reactionType: null })).toBe(current);
    expect(withReactionChange(undefined, { messageId: 'm1', userId: 'a', reactionType: 'like' })).toBeUndefined();
  });
});
