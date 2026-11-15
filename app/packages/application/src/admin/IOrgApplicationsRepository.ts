// V2-ADMIN-ORG-7, FR-ORG-002 — port for the review of organization applications.
import type { OrgApplicationPage, OrgApplicationStatus } from '@kc/domain';

export interface OrgApplicationListFilters {
  readonly status?: OrgApplicationStatus;
  /** Newest first; the page holds at most this many applications. */
  readonly limit?: number;
}

export interface IOrgApplicationsRepository {
  list(filters: OrgApplicationListFilters): Promise<OrgApplicationPage>;
  /** Creates the organization at the web address `slug` and makes the applicant its first admin. */
  approve(applicationId: string, slug: string, note?: string | null): Promise<void>;
  reject(applicationId: string, note?: string | null): Promise<void>;
}
