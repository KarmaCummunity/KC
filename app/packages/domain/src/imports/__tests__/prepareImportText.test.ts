import { describe, expect, it } from 'vitest';
import { ImportExtractionError } from '../ImportExtractionError';
import { prepareImportText } from '../prepareImportText';

describe('prepareImportText', () => {
  it('normalizes then scrubs and carries the timestamp and removal counts', () => {
    const out = prepareImportText('4.11.2026, 12:03 - דנה: מוסרת ספה, 050-1234567');
    expect(out.text).toBe('מוסרת ספה, <PHONE>');
    expect(out.messageAt).not.toBeNull();
    expect(out.removed.phone).toBe(1);
  });

  it.each(['', '   ', '050-1234567', '<PHONE> <URL>', '!!! ???', '😀😀'])(
    'rejects %j as empty (FR-IMPORT-002 AC5)',
    (raw) => {
      expect(() => prepareImportText(raw)).toThrow(ImportExtractionError);
      try {
        prepareImportText(raw);
      } catch (e) {
        expect((e as ImportExtractionError).code).toBe('import_extraction');
        expect((e as ImportExtractionError).reason).toBe('empty_text');
      }
    },
  );
});
