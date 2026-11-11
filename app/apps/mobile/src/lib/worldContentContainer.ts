// Composition of the "links and knowledge" reads of a giving world (migration 0021). Kept out
// of `container.ts`, which is at its size cap.
import { GetWorldContentUseCase } from '@kc/application';
import { SupabaseWorldContentRepository } from '@kc/infrastructure-supabase';
import { supabase } from './container';

export const worldContentContainer = {
  getWorldContent: new GetWorldContentUseCase(new SupabaseWorldContentRepository(supabase)),
};
