// Composition of the "links and knowledge" reads of a giving world (migration 0024) and
// knowledge shelf official links (FR-KNOW-012 AC2). Kept out of `container.ts` (size cap).
import { GetWorldContentUseCase, ListKnowledgeShelfLinksUseCase } from '@kc/application';
import { SupabaseWorldContentRepository } from '@kc/infrastructure-supabase';
import { supabase } from './container';

const repo = new SupabaseWorldContentRepository(supabase);

export const worldContentContainer = {
  getWorldContent: new GetWorldContentUseCase(repo),
  listKnowledgeShelfLinks: new ListKnowledgeShelfLinksUseCase(repo),
};
