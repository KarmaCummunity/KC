import { describe, it, expect } from 'vitest';
import { chunkArray } from '../chunkArray';

describe('chunkArray', () => {
  it('splits an array into chunks of the given size', () => {
    const input = [1, 2, 3, 4, 5];
    const result = chunkArray(input, 2);
    expect(result).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns empty array when input is empty', () => {
    expect(chunkArray([], 3)).toEqual([]);
  });

  it('returns single chunk when size is greater than array length', () => {
    expect(chunkArray(['a', 'b'], 5)).toEqual([['a', 'b']]);
  });

  it('safely handles size <= 0 without an infinite loop', () => {
    expect(chunkArray([1, 2, 3], 0)).toEqual([]);
    expect(chunkArray([1, 2, 3], -1)).toEqual([]);
  });
});
