// FR-ADMIN-032 — port for CRM contacts. Every contact belongs to one organization; the
// server lets only that organization's managers reach it.
import type { CrmContactPage, CrmContactStatus, CrmOrg } from '@kc/domain';

export interface CrmContactListFilters {
  readonly orgId: string;
  readonly status?: CrmContactStatus;
  readonly query?: string;
  readonly tag?: string;
  readonly limit?: number;
  /** `nextCursor` of the previous page; omitted for the first page. */
  readonly cursor?: string;
}

export interface CrmContactUpsertInput {
  readonly orgId: string;
  readonly contactId?: string | null;
  readonly name?: string;
  readonly organization?: string | null;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly roleTitle?: string | null;
  readonly notes?: string | null;
  readonly tags?: readonly string[] | null;
  readonly status?: CrmContactStatus;
}

export interface ICrmContactsRepository {
  /** The organizations whose book the viewer manages, the platform organization first. */
  listOrgs(): Promise<readonly CrmOrg[]>;
  list(filters: CrmContactListFilters): Promise<CrmContactPage>;
  upsert(input: CrmContactUpsertInput): Promise<string>;
  delete(contactId: string): Promise<void>;
  markContacted(contactId: string): Promise<void>;
}
