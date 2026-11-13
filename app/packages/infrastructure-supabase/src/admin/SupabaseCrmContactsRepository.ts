// FR-ADMIN-032 — CRM contacts per organization over the crm_* RPCs (supabase/migrations/0035).
//
// Each organization keeps its own book; the server lets only its managers in (org_admin,
// org_manager, and platform staff for the platform organization). The list is keyset-paged
// and its total comes from `crm_contact_count` with the same filters.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CrmContactListFilters, CrmContactUpsertInput, ICrmContactsRepository } from '@kc/application';
import {
  CrmContactError,
  parseCrmContactStatus,
  type CrmContact,
  type CrmContactErrorCode,
  type CrmContactPage,
  type CrmOrg,
} from '@kc/domain';
import type { Database, Json } from '../database.types';
import { toBackendUnavailable, type BackendErrorLike } from '../rpc/backendUnavailable';
import type { CallResult } from '../rpc/mapRpcError';
import { asRecord, date, decodeCursor, readPage, str, strings } from './backOfficePaging';

type Client = SupabaseClient<Database>;

const DEFAULT_PAGE = 50;

const KNOWN_ERRORS: ReadonlySet<string> = new Set<CrmContactErrorCode>([
  'forbidden', 'invalid_name', 'invalid_status', 'invalid_email', 'invalid_phone', 'invalid_input',
  'contact_not_found',
]);

function toError(err: BackendErrorLike): CrmContactError {
  const message = err.message ?? '';
  if (KNOWN_ERRORS.has(message)) return new CrmContactError(message as CrmContactErrorCode);
  if (err.code === '42501') return new CrmContactError('forbidden');
  return new CrmContactError('unknown', message || 'crm call failed');
}

function unwrap<T>(rpc: string, result: CallResult<T>): T {
  if (!result.error) return result.data;
  throw toBackendUnavailable(`rpc:${rpc}`, result.error) ?? toError(result.error);
}

/** A contact record; null when it is not an object or its status is unknown. */
export function mapCrmContact(value: Json): CrmContact | null {
  const row = asRecord(value);
  if (row === null) return null;
  const contactId = str(row, 'contact_id');
  const name = str(row, 'name');
  const status = parseCrmContactStatus(str(row, 'status'));
  const createdAt = date(row, 'created_at');
  if (contactId === null || name === null || status === null || createdAt === null) return null;
  return {
    contactId,
    name,
    organization: str(row, 'organization'),
    email: str(row, 'email'),
    phone: str(row, 'phone'),
    roleTitle: str(row, 'role_title'),
    notes: str(row, 'notes'),
    tags: strings(row, 'tags'),
    status,
    lastContactedAt: date(row, 'last_contacted_at'),
    createdAt,
    updatedAt: date(row, 'updated_at') ?? createdAt,
  };
}

/**
 * A patch value: `undefined` keeps the field (the RPC reads null as "keep"), and `null`
 * clears it (the RPC reads an empty string as "clear").
 */
const patch = (value: string | null | undefined): string | undefined => (value === null ? '' : value);

export class SupabaseCrmContactsRepository implements ICrmContactsRepository {
  constructor(private readonly client: Client) {}

  async listOrgs(): Promise<readonly CrmOrg[]> {
    const rows = unwrap('crm_my_orgs', await this.client.rpc('crm_my_orgs'));
    return (rows ?? []).map((row) => ({ orgId: row.org_id, name: row.name, isPlatform: row.is_platform }));
  }

  async list(filters: CrmContactListFilters): Promise<CrmContactPage> {
    const limit = filters.limit ?? DEFAULT_PAGE;
    const shared = {
      p_org_id: filters.orgId,
      p_status: filters.status,
      p_query: filters.query?.trim() || undefined,
      p_tag: filters.tag,
    };
    const [rows, total] = await Promise.all([
      this.client.rpc('crm_contact_list', { ...shared, p_limit: limit, p_cursor: decodeCursor(filters.cursor) ?? undefined }),
      this.client.rpc('crm_contact_count', shared),
    ]);
    const page = readPage(unwrap('crm_contact_list', rows), limit, (row) => mapCrmContact(row.contact));
    return { ...page, totalCount: unwrap('crm_contact_count', total) ?? 0 };
  }

  async upsert(input: CrmContactUpsertInput): Promise<string> {
    const id = unwrap('crm_contact_upsert', await this.client.rpc('crm_contact_upsert', {
      p_org_id: input.orgId,
      p_contact_id: input.contactId ?? undefined,
      p_name: input.name,
      p_organization: patch(input.organization),
      p_email: patch(input.email),
      p_phone: patch(input.phone),
      p_role_title: patch(input.roleTitle),
      p_notes: patch(input.notes),
      p_tags: input.tags ? [...input.tags] : undefined,
      p_status: input.status,
    }));
    if (typeof id !== 'string') throw new CrmContactError('unknown', 'crm_contact_upsert returned no id');
    return id;
  }

  async delete(contactId: string): Promise<void> {
    unwrap('crm_contact_delete', await this.client.rpc('crm_contact_delete', { p_contact_id: contactId }));
  }

  async markContacted(contactId: string): Promise<void> {
    unwrap('crm_contact_mark_contacted', await this.client.rpc('crm_contact_mark_contacted', { p_contact_id: contactId }));
  }
}
