// FR-IMPORT-001 AC1 — the shared message for the import screen's field.
import { describe, expect, it } from 'vitest';
import { sharedImportText } from '../sharedImportText';

describe('sharedImportText', () => {
  it('nothing shared is null', () => {
    expect(sharedImportText({})).toBeNull();
    expect(sharedImportText({ title: '  ', text: '' })).toBeNull();
  });

  it('a WhatsApp share is its text', () => {
    expect(sharedImportText({ text: 'Giving a sofa in Haifa' })).toBe('Giving a sofa in Haifa');
  });

  it('joins title, text and link once each, in that order', () => {
    expect(sharedImportText({ title: 'Sofa', text: 'Three seats, free', url: 'https://example.test/p/1' }))
      .toBe('Sofa\nThree seats, free\nhttps://example.test/p/1');
  });

  it('does not repeat a piece another already holds', () => {
    expect(sharedImportText({ title: 'Sofa', text: 'Sofa for free https://example.test/p/1', url: 'https://example.test/p/1' }))
      .toBe('Sofa\nSofa for free https://example.test/p/1');
  });

  it('reads the first value of a repeated parameter', () => {
    expect(sharedImportText({ text: ['first', 'second'] })).toBe('first');
  });
});
