// §5.11 (#1476) — wires the admin portal's job-posting switch per organization.
import { ListOrgJobPostingUseCase, SetOrgMayPostJobsUseCase } from '@kc/application';
import { getSupabaseClient, SupabaseOrgJobPostingAdminRepository } from '@kc/infrastructure-supabase';
import { pickAuthStorage } from './authSecureStorage';

let repo: SupabaseOrgJobPostingAdminRepository | null = null;

/** The one repository instance, built on first use with the signed-in client. */
function repository(): SupabaseOrgJobPostingAdminRepository {
  repo ??= new SupabaseOrgJobPostingAdminRepository(getSupabaseClient({ storage: pickAuthStorage() }));
  return repo;
}

export const orgJobPostingAdminUseCases = {
  list: () => new ListOrgJobPostingUseCase(repository()),
  set: () => new SetOrgMayPostJobsUseCase(repository()),
};
