// Spec 05 §5.11 (#1476): the admin portal's job-posting switch per organization. Platform staff
// read every organization (suspended ones included, by their policy); the write goes through
// `admin_set_org_may_post_jobs`, which checks the admin role and audits the change.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { IOrgJobPostingAdminRepository, OrgJobPostingRow } from '@kc/application';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

interface OrganizationRow {
  readonly id: string;
  readonly name: string;
  readonly is_platform: boolean;
  readonly status: string;
  readonly may_post_jobs: boolean;
}

/** One organization as the admin screen shows it. */
export function toOrgJobPostingRow(row: OrganizationRow): OrgJobPostingRow {
  return {
    orgId: row.id,
    name: row.name,
    isPlatform: row.is_platform,
    isActive: row.status === 'active',
    mayPostJobs: row.may_post_jobs,
  };
}

export class SupabaseOrgJobPostingAdminRepository implements IOrgJobPostingAdminRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async listOrganizations(): Promise<OrgJobPostingRow[]> {
    const rows = unwrapCall(
      'table:organizations',
      await this.client.from('organizations').select('id, name, is_platform, status, may_post_jobs').order('name'),
    );
    return (rows ?? []).map(toOrgJobPostingRow);
  }

  async setMayPostJobs(orgId: string, enabled: boolean): Promise<void> {
    unwrapCall(
      'rpc:admin_set_org_may_post_jobs',
      await this.client.rpc('admin_set_org_may_post_jobs', { p_org_id: orgId, p_enabled: enabled }),
    );
  }
}
