/**
 * Platform admins decide which organizations may publish job offers (spec 05 §5.11, #1476).
 * The server checks the role and audits each change (`admin_set_org_may_post_jobs`); this port
 * only carries the reads and the call.
 */
export interface OrgJobPostingRow {
  readonly orgId: string;
  readonly name: string;
  /** Karma Community itself: always allowed, so its switch is not shown. */
  readonly isPlatform: boolean;
  /** A suspended organization may not post jobs, whatever its switch. */
  readonly isActive: boolean;
  readonly mayPostJobs: boolean;
}

export interface IOrgJobPostingAdminRepository {
  /** Every organization the caller may read, by name. */
  listOrganizations(): Promise<OrgJobPostingRow[]>;
  /** Allows or stops an organization posting job offers. Rejects when the caller is not a platform admin. */
  setMayPostJobs(orgId: string, enabled: boolean): Promise<void>;
}
