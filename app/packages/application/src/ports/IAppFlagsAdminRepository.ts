/**
 * Writes a feature flag of `public.app_flags` as the super admin (#2277). The server checks the
 * role and audits the change (`admin_set_app_flag`); this port only carries the call.
 */
export interface IAppFlagsAdminRepository {
  /** Creates the flag or switches it. Rejects when the caller may not switch flags. */
  setFlag(key: string, enabled: boolean): Promise<void>;
}
