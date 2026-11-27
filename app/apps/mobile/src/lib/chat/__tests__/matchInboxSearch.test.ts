import { describe, expect, it } from 'vitest';
import { matchesInboxNamePrefix } from '../matchInboxSearch';

const DAVID_PLAIN = '\u05D3\u05D5\u05D3';
const DAVID_NIQQUD = '\u05D3\u05B8\u05D5\u05B4\u05D3';

describe('matchesInboxNamePrefix (FR-CHAT-001 AC3 niqqud)', () => {
  it('matches a niqqud query against a plain display name and vice versa', () => {
    expect(matchesInboxNamePrefix(DAVID_PLAIN, DAVID_NIQQUD)).toBe(true);
    expect(matchesInboxNamePrefix(DAVID_NIQQUD, DAVID_PLAIN)).toBe(true);
    expect(matchesInboxNamePrefix(DAVID_NIQQUD, DAVID_NIQQUD.slice(0, 2))).toBe(true);
  });

  it('keeps case-insensitive Latin prefix matching and ignores empty query', () => {
    expect(matchesInboxNamePrefix("O'Brien", 'o\'br')).toBe(true);
    expect(matchesInboxNamePrefix("O'Brien", 'x')).toBe(false);
    expect(matchesInboxNamePrefix('Alice', '   ')).toBe(true);
  });
});
