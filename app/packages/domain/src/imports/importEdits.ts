// FR-IMPORT-010 AC4 — which fields of an import draft the member changed before publishing. The
// share of published imports that changed each field (`import_field_edit_rate`) is the production
// signal of extraction quality: a field the member keeps fixing is a field the pipeline gets wrong.

/** The draft fields whose edits are counted; the database accepts these names only. */
export const IMPORT_EDITABLE_FIELDS = ['world', 'direction', 'kind', 'subcategory', 'title', 'description', 'city'] as const;
export type ImportEditableField = (typeof IMPORT_EDITABLE_FIELDS)[number];

/** Field values as the form held them: ids and slugs, or the text. Absent means "not seeded / not sent". */
export type ImportFieldValues = Partial<Record<ImportEditableField, string | null>>;

/** Text compared as the member would read it: surrounding and repeated whitespace do not count as an edit. */
function comparable(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * The fields the draft seeded and the published post holds differently, in the order of
 * `IMPORT_EDITABLE_FIELDS`. A field the draft left empty and the member filled is an edit too (the
 * pipeline missed it); a field the published post does not report is not judged.
 */
export function editedImportFields(seeded: ImportFieldValues, published: ImportFieldValues): ImportEditableField[] {
  return IMPORT_EDITABLE_FIELDS.filter(
    (field) => field in seeded && field in published && comparable(seeded[field]) !== comparable(published[field]),
  );
}
