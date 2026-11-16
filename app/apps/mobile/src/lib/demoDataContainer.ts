// Composition of the Demo data screen's use cases (FR-ADMIN-031), kept out of container.ts for
// its 300-line cap. The adapter calls the dev-only demo-data RPCs (supabase/seed/demo).
import type { SupabaseClient } from '@supabase/supabase-js';
import { type Database, SupabaseDemoDataRepository } from '@kc/infrastructure-supabase';
import { GetDemoDataStatusUseCase, RestoreDemoDataUseCase, WipeDemoDataUseCase } from '@kc/application';

/** Read the status, delete all demo data, restore it. */
export function createDemoDataUseCases(supabase: SupabaseClient<Database>) {
  const repo = new SupabaseDemoDataRepository(supabase);
  return {
    getDemoDataStatus: new GetDemoDataStatusUseCase(repo),
    wipeDemoData: new WipeDemoDataUseCase(repo),
    restoreDemoData: new RestoreDemoDataUseCase(repo),
  };
}
