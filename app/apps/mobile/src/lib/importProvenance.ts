// FR-IMPORT-007 AC3 — the words of the provenance chip on an imported post.
import type { ImportSourcePlatform } from '@kc/domain';

/** The i18n key of the chip; null for a post made in KC (no chip). */
export function provenanceLabelKey(importedFrom: ImportSourcePlatform | null | undefined): string | null {
  switch (importedFrom) {
    case 'whatsapp':
    case 'facebook':
    case 'yad2':
      return `postImport.provenance.${importedFrom}`;
    case 'other':
    case 'unknown':
      // The member did not name a known platform: the chip says the post was imported, no more.
      return 'postImport.provenance.imported';
    default:
      return null;
  }
}
