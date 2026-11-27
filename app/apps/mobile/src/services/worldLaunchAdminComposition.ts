// #2277 — wires the admin world switch: the super admin's flag writer behind its use case.
import { SetWorldLaunchModeUseCase } from '@kc/application';
import { getSupabaseClient, SupabaseAppFlagsAdminRepository } from '@kc/infrastructure-supabase';
import { pickAuthStorage } from './authSecureStorage';
import { viaApi } from './backend/apiBackend';

let setWorldLaunchMode: SetWorldLaunchModeUseCase | null = null;

/** The one use case instance, built on first use with the signed-in client. */
export function getSetWorldLaunchModeUseCase(): SetWorldLaunchModeUseCase {
  setWorldLaunchMode ??= new SetWorldLaunchModeUseCase(
    viaApi('appFlagsAdmin', new SupabaseAppFlagsAdminRepository(getSupabaseClient({ storage: pickAuthStorage() }))),
  );
  return setWorldLaunchMode;
}
