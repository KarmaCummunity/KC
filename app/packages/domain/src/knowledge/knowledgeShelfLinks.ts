// FR-KNOW-012 AC2 / D40 — official body links on a knowledge shelf, and when the
// "not binding advice" notice must show (consulting hour or rights & legal aid).
import { isKnowledgeShelfSlug, type KnowledgeShelfSlug } from './knowledgeTopics';

/** One official body link configured for a knowledge shelf (KC-team content, S18). */
export interface KnowledgeShelfLink {
  readonly linkId: string;
  readonly shelfSlug: KnowledgeShelfSlug;
  readonly linkSlug: string;
  readonly labelHe: string;
  readonly labelEn: string;
  readonly url: string;
}

/** The rights & legal aid shelf always shows the D40 notice and its official links. */
export const RIGHTS_LEGAL_AID_SHELF: KnowledgeShelfSlug = 'rights_legal_aid';

/** True when the listing kind is a consulting hour (profession is required on create). */
export function isConsultingHourKind(kindSlug: string | null | undefined): boolean {
  return kindSlug === 'consulting_hour';
}

/**
 * True when a knowledge exchange post must show the §18.9 "not binding advice" notice:
 * a consulting hour, or any post on the rights & legal aid shelf.
 */
export function showsKnowledgeAdviceNotice(input: {
  readonly kindSlug?: string | null;
  readonly shelfSlug?: string | null;
  /** Chat / feed cards may only have free `details` (profession marks a consulting hour). */
  readonly details?: Readonly<Record<string, unknown>> | null;
}): boolean {
  if (isConsultingHourKind(input.kindSlug)) return true;
  if (input.shelfSlug && input.shelfSlug === RIGHTS_LEGAL_AID_SHELF) return true;
  if (typeof input.details?.['profession'] === 'string' && input.details['profession'].trim() !== '') {
    return true;
  }
  return false;
}

/** Narrows an untrusted shelf slug from the subcategory catalog. */
export function knowledgeShelfSlugOf(value: string | null | undefined): KnowledgeShelfSlug | null {
  if (!value) return null;
  return isKnowledgeShelfSlug(value) ? value : null;
}
