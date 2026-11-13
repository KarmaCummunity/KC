// V2-ADMIN-ORG-7, FR-ORG-002 — Supabase adapter for the review of organization applications.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { IOrgApplicationsRepository, OrgApplicationListFilters } from '@kc/application';
import {
  OrgApplicationError,
  parseOrgApplicationStatus,
  type OrgApplication,
  type OrgApplicationErrorCode,
  type OrgApplicationPage,
} from '@kc/domain';
import type { Database } from '../database.types';
import { toBackendUnavailable, type BackendErrorLike } from '../rpc/backendUnavailable';
import type { CallResult } from '../rpc/mapRpcError';

type Client = SupabaseClient<Database>;
type ApplicationRow = Database['public']['Tables']['org_applications']['Row'];

const DEFAULT_PAGE = 50;

const BY_MESSAGE: Readonly<Record<string, OrgApplicationErrorCode>> = {
  application_not_found: 'application_not_found',
  application_already_decided: 'application_already_decided',
  slug_required: 'invalid_slug',
  forbidden: 'forbidden',
  unauthenticated: 'forbidden',
  invalid_status: 'invalid_status',
};

function toError(err: BackendErrorLike): OrgApplicationError {
  const msg = err.message ?? '';
  const mapped = BY_MESSAGE[msg];
  if (mapped) return new OrgApplicationError(mapped);
  if (err.code === '42501') return new OrgApplicationError('forbidden');
  // The organization slug is unique; a check violation is a slug the table refuses.
  if (err.code === '23505') return new OrgApplicationError('slug_taken');
  if (err.code === '23514') return new OrgApplicationError('invalid_slug');
  return new OrgApplicationError('unknown', msg);
}

function unwrap<T>(object: string, result: CallResult<T>): T {
  if (!result.error) return result.data;
  throw toBackendUnavailable(object, result.error) ?? toError(result.error);
}

export function mapOrgApplicationRow(row: ApplicationRow, names: ReadonlyMap<string, string | null>): OrgApplication | null {
  const status = parseOrgApplicationStatus(row.status);
  if (status === null) return null;
  return {
    applicationId: row.id,
    applicantUserId: row.applicant_id,
    applicantName: names.get(row.applicant_id) ?? null,
    orgName: row.org_name,
    orgDescription: row.org_description,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    websiteUrl: row.website_url,
    status,
    createdAt: new Date(row.created_at),
    reviewedAt: row.reviewed_at === null ? null : new Date(row.reviewed_at),
    reviewedBy: row.reviewed_by,
    reviewerName: row.reviewed_by ? (names.get(row.reviewed_by) ?? null) : null,
    reviewNote: row.review_note,
  };
}

/**
 * Applications are a direct read of `org_applications` (policy `org_applications_select_reviewers`,
 * platform admins) with the applicant's and reviewer's names from `users`; the decision goes through
 * `admin_org_application_approve` / `_reject` (supabase/schemas/80_organizations/030).
 */
export class SupabaseOrgApplicationsRepository implements IOrgApplicationsRepository {
  constructor(private readonly client: Client) {}

  async list(filters: OrgApplicationListFilters): Promise<OrgApplicationPage> {
    let query = this.client.from('org_applications').select('*', { count: 'exact' });
    if (filters.status) query = query.eq('status', filters.status);
    const result = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(filters.limit ?? DEFAULT_PAGE);
    const rows = unwrap('table:org_applications', result) ?? [];
    const memberIds = [...new Set(rows.flatMap((r) => (r.reviewed_by ? [r.applicant_id, r.reviewed_by] : [r.applicant_id])))];
    const users = memberIds.length > 0
      ? unwrap('table:users', await this.client.from('users').select('id, display_name').in('id', memberIds)) ?? []
      : [];
    const names = new Map(users.map((u) => [u.id, u.display_name]));
    return {
      rows: rows.map((row) => mapOrgApplicationRow(row, names)).filter((a): a is OrgApplication => a !== null),
      totalCount: result.count ?? rows.length,
    };
  }

  async approve(applicationId: string, slug: string, note?: string | null): Promise<void> {
    unwrap(
      'rpc:admin_org_application_approve',
      await this.client.rpc('admin_org_application_approve', { p_application_id: applicationId, p_slug: slug, p_note: note ?? undefined }),
    );
  }

  async reject(applicationId: string, note?: string | null): Promise<void> {
    unwrap(
      'rpc:admin_org_application_reject',
      await this.client.rpc('admin_org_application_reject', { p_application_id: applicationId, p_note: note ?? undefined }),
    );
  }
}
