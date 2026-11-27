import { describe, expect, it } from 'vitest';
import {
  RIGHTS_LEGAL_AID_SHELF,
  isConsultingHourKind,
  knowledgeShelfSlugOf,
  showsKnowledgeAdviceNotice,
} from '../knowledgeShelfLinks';

describe('knowledgeShelfLinks helpers (FR-KNOW-012)', () => {
  it('detects a consulting hour kind', () => {
    expect(isConsultingHourKind('consulting_hour')).toBe(true);
    expect(isConsultingHourKind('lesson_offer')).toBe(false);
  });

  it('shows the notice for consulting hours and the rights shelf', () => {
    expect(showsKnowledgeAdviceNotice({ kindSlug: 'consulting_hour' })).toBe(true);
    expect(showsKnowledgeAdviceNotice({ shelfSlug: RIGHTS_LEGAL_AID_SHELF })).toBe(true);
    expect(showsKnowledgeAdviceNotice({ details: { profession: 'lawyer' } })).toBe(true);
    expect(showsKnowledgeAdviceNotice({ kindSlug: 'lesson_offer', shelfSlug: 'culture_art' })).toBe(false);
  });

  it('narrows shelf slugs', () => {
    expect(knowledgeShelfSlugOf('rights_legal_aid')).toBe('rights_legal_aid');
    expect(knowledgeShelfSlugOf('books')).toBeNull();
  });
});
