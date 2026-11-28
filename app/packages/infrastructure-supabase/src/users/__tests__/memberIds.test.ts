import { describe, it, expect } from 'vitest';
import { memberEntry, presentMemberIds } from '../memberIds';

describe('member ids of a deleted member (#2088)', () => {
  it('drops NULL ids and duplicates', () => {
    expect(presentMemberIds(['a', null, 'b', 'a', null])).toEqual(['a', 'b']);
    expect(presentMemberIds([null])).toEqual([]);
  });

  it('finds nobody for a NULL id', () => {
    const byId = new Map([['a', 1]]);
    expect(memberEntry(byId, 'a')).toBe(1);
    expect(memberEntry(byId, null)).toBeUndefined();
    expect(memberEntry(byId, 'b')).toBeUndefined();
  });
});
