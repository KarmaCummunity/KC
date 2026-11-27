import { describe, expect, it } from 'vitest';
import { normalizeChatSearchText, stripHebrewNiqqud } from '../hebrewText';

// Dalet-vav-dalet ("David") plain vs with qamats + hiriq (U+05B8, U+05B4 ∈ U+0591–U+05C7).
const DAVID_PLAIN = '\u05D3\u05D5\u05D3';
const DAVID_NIQQUD = '\u05D3\u05B8\u05D5\u05B4\u05D3';

describe('stripHebrewNiqqud', () => {
  it('removes niqqud and cantillation marks in U+0591–U+05C7', () => {
    expect(stripHebrewNiqqud(DAVID_NIQQUD)).toBe(DAVID_PLAIN);
    expect(stripHebrewNiqqud(`${DAVID_PLAIN}\u0591`)).toBe(DAVID_PLAIN);
  });

  it('leaves non-Hebrew text unchanged', () => {
    expect(stripHebrewNiqqud("O'Brien-42")).toBe("O'Brien-42");
  });
});

describe('normalizeChatSearchText', () => {
  it('matches a niqqud query against plain haystack and vice versa', () => {
    expect(normalizeChatSearchText(DAVID_NIQQUD)).toBe(normalizeChatSearchText(DAVID_PLAIN));
    expect(normalizeChatSearchText(DAVID_PLAIN).startsWith(normalizeChatSearchText(DAVID_NIQQUD))).toBe(
      true,
    );
    expect(normalizeChatSearchText(DAVID_NIQQUD).startsWith(normalizeChatSearchText(DAVID_PLAIN))).toBe(
      true,
    );
  });

  it('lower-cases Latin without altering punctuation or digits', () => {
    expect(normalizeChatSearchText("O'Brien-42")).toBe("o'brien-42");
  });
});
