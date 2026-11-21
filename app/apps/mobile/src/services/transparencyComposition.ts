// FR-FIN-022 — lazy singleton for the public transparency read (guests included).
// Kept out of lib/container so About / Stats do not pull the admin wiring.
import { GetOrgTransparencyUseCase } from '@kc/application';
import { SupabaseOrgTransparencyRepository, getSupabaseClient } from '@kc/infrastructure-supabase';
import { pickAuthStorage } from './authSecureStorage';
import { viaApi } from './backend/apiBackend';

let _getOrgTransparency: GetOrgTransparencyUseCase | undefined;

export function getOrgTransparencyUseCase(): GetOrgTransparencyUseCase {
  _getOrgTransparency ??= new GetOrgTransparencyUseCase(
    viaApi('orgTransparency', new SupabaseOrgTransparencyRepository(getSupabaseClient({ storage: pickAuthStorage() }))),
  );
  return _getOrgTransparency;
}
