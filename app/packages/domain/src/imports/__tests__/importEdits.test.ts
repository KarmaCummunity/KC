// FR-IMPORT-010 AC4 — the fields of an import draft the member changed before publishing.
import { describe, expect, it } from 'vitest';
import { editedImportFields } from '../importEdits';

const seeded = { world: 'items', direction: 'give', title: 'Sofa', description: 'Three seats', city: 'c1' };

describe('editedImportFields', () => {
  it('nothing changed is no edit', () => {
    expect(editedImportFields(seeded, { ...seeded })).toEqual([]);
  });

  it('lists the changed fields in a stable order', () => {
    expect(editedImportFields(seeded, { ...seeded, city: 'c2', direction: 'request', title: 'Sofa bed' }))
      .toEqual(['direction', 'title', 'city']);
  });

  it('whitespace alone is not an edit', () => {
    expect(editedImportFields(seeded, { ...seeded, title: '  Sofa ', description: 'Three   seats\n' })).toEqual([]);
  });

  it('a field the draft left empty and the member filled is an edit', () => {
    expect(editedImportFields({ ...seeded, city: null }, { ...seeded, city: 'c9' })).toEqual(['city']);
  });

  it('a field not seeded, or not reported by the published post, is not judged', () => {
    expect(editedImportFields({ title: 'Sofa' }, { title: 'Sofa', city: 'c9' })).toEqual([]);
    expect(editedImportFields(seeded, { title: 'Sofa' })).toEqual([]);
  });
});
