// V2-ADMIN-CRM-8 — admin CRM contacts (roadmap phase 3).
//
// The production baseline has no CRM (docs/db/app-migration-map.md, M19): back-office tools are
// internal data, and whether they belong in this database is an open product decision. The
// adapter therefore makes no call: every method reports the capability as missing with
// `BackendUnavailableError`, and the CRM screen shows its unavailable state
// (apps/mobile/src/lib/parkedFeatures.ts). The previous RPC adapter is in git history.
import type {
  CrmContactListFilters,
  CrmContactUpsertInput,
  ICrmContactsRepository,
} from '@kc/application';
import { BackendUnavailableError, type CrmContactPage } from '@kc/domain';

const unavailable = (rpc: string): Promise<never> =>
  Promise.reject(new BackendUnavailableError(`rpc:${rpc}`, 'function'));

export class SupabaseCrmContactsRepository implements ICrmContactsRepository {
  list(_filters: CrmContactListFilters): Promise<CrmContactPage> {
    return unavailable('crm_contact_list');
  }

  upsert(_input: CrmContactUpsertInput): Promise<string> {
    return unavailable('crm_contact_upsert');
  }

  delete(_contactId: string): Promise<void> {
    return unavailable('crm_contact_delete');
  }

  markContacted(_contactId: string): Promise<void> {
    return unavailable('crm_contact_mark_contacted');
  }
}
