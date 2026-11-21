// Composition of the Demo data screen's use cases (FR-ADMIN-031, and the "Copied from production"
// card of FR-ADMIN-037), kept out of container.ts for its 300-line cap. The adapters call the
// dev-only RPCs of supabase/seed/demo and supabase/seed/prod-copy.
import type { SupabaseClient } from '@supabase/supabase-js';
import { type Database, SupabaseDemoDataRepository, SupabaseProdCopyRepository } from '@kc/infrastructure-supabase';
import {
  DeleteProdCopyUseCase,
  GetDemoDataStatusUseCase,
  GetProdCopyStatusUseCase,
  RestoreDemoDataUseCase,
  WipeDemoDataUseCase,
} from '@kc/application';
import { viaApi } from '../services/backend/apiBackend';

/** Read the status, delete all demo data, restore it; read and delete the production copy. */
export function createDemoDataUseCases(supabase: SupabaseClient<Database>) {
  const repo = viaApi('demoData', new SupabaseDemoDataRepository(supabase));
  const prodCopy = viaApi('prodCopy', new SupabaseProdCopyRepository(supabase));
  return {
    getDemoDataStatus: new GetDemoDataStatusUseCase(repo),
    wipeDemoData: new WipeDemoDataUseCase(repo),
    restoreDemoData: new RestoreDemoDataUseCase(repo),
    getProdCopyStatus: new GetProdCopyStatusUseCase(prodCopy),
    deleteProdCopy: new DeleteProdCopyUseCase(prodCopy),
  };
}
