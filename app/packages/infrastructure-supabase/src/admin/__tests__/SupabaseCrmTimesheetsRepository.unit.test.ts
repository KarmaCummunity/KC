// FR-ADMIN-032 / FR-ADMIN-033 — the CRM and timesheet adapters: organization scoping, patch
// semantics (undefined keeps, null clears), list + count with one set of filters, keyset
// paging, `can_decide`, and error mapping by stable message.
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../database.types';
import { SupabaseCrmContactsRepository } from '../SupabaseCrmContactsRepository';
import { SupabaseTimesheetsRepository } from '../SupabaseTimesheetsRepository';

type Rpc = (name: string, args?: unknown) => unknown;

function clientWith(rpc: Rpc) {
  const spy = vi.fn(async (name: string, args?: unknown) => rpc(name, args));
  return { client: { rpc: spy } as unknown as SupabaseClient<Database>, rpc: spy };
}

const CONTACT = {
  contact_id: 'c1', name: 'Dana', organization: 'Acme', email: 'dana@acme.test', phone: null, role_title: null,
  notes: null, tags: ['donor'], status: 'warm', last_contacted_at: null,
  created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-02T00:00:00Z',
};
const ENTRY = {
  entry_id: 'e1', user_id: 'u1', user_name: 'Noa', work_date: '2026-11-10', hours_x100: 250, project: 'A',
  description: null, status: 'submitted', submitted_at: '2026-11-10T12:00:00Z', approved_at: null,
  approved_by: null, approver_name: null, approval_note: null, can_decide: true,
  created_at: '2026-11-10T00:00:00Z', updated_at: '2026-11-10T00:00:00Z',
};

describe('SupabaseCrmContactsRepository', () => {
  it('lists the organizations the viewer manages', async () => {
    const { client } = clientWith(() => ({ data: [{ org_id: 'o1', name: 'Karma Community', is_platform: true }], error: null }));
    expect(await new SupabaseCrmContactsRepository(client).listOrgs()).toEqual([{ orgId: 'o1', name: 'Karma Community', isPlatform: true }]);
  });

  it('lists one organization with the same filters for the page and the count', async () => {
    const { client, rpc } = clientWith((name) => (name === 'crm_contact_count'
      ? { data: 7, error: null }
      : { data: [{ contact: CONTACT, cursor: { updated_at: 'x', id: 'c1' } }], error: null }));
    const page = await new SupabaseCrmContactsRepository(client).list({ orgId: 'o1', query: '  acme ', limit: 1 });
    expect(page).toMatchObject({ totalCount: 7, nextCursor: JSON.stringify({ updated_at: 'x', id: 'c1' }) });
    expect(page.rows[0]).toMatchObject({ contactId: 'c1', status: 'warm', tags: ['donor'] });
    const filters = { p_org_id: 'o1', p_query: 'acme', p_status: undefined, p_tag: undefined };
    expect(rpc).toHaveBeenCalledWith('crm_contact_count', filters);
    expect(rpc).toHaveBeenCalledWith('crm_contact_list', expect.objectContaining({ ...filters, p_limit: 1 }));
  });

  it('keeps an undefined field and clears a null one', async () => {
    const { client, rpc } = clientWith(() => ({ data: 'c1', error: null }));
    await new SupabaseCrmContactsRepository(client).upsert({ orgId: 'o1', contactId: 'c1', email: null, notes: 'n' });
    expect(rpc).toHaveBeenCalledWith('crm_contact_upsert', expect.objectContaining({
      p_org_id: 'o1', p_contact_id: 'c1', p_email: '', p_notes: 'n', p_phone: undefined, p_name: undefined,
    }));
  });

  it('maps the new validation codes and 42501', async () => {
    const invalid = clientWith(() => ({ data: null, error: { code: 'P0001', message: 'invalid_phone' } }));
    await expect(new SupabaseCrmContactsRepository(invalid.client).upsert({ orgId: 'o1', name: 'x' }))
      .rejects.toMatchObject({ code: 'invalid_phone' });
    const forbidden = clientWith(() => ({ data: null, error: { code: '42501', message: 'forbidden' } }));
    await expect(new SupabaseCrmContactsRepository(forbidden.client).delete('c1')).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('SupabaseTimesheetsRepository', () => {
  it('lists a scope with its count and maps can_decide', async () => {
    const { client, rpc } = clientWith((name) => (name === 'timesheet_count'
      ? { data: 1, error: null }
      : { data: [{ entry: ENTRY, cursor: { id: 'e1' } }], error: null }));
    const page = await new SupabaseTimesheetsRepository(client).list({ scope: 'to_decide' });
    expect(page).toMatchObject({ totalCount: 1, nextCursor: null });
    expect(page.rows[0]).toMatchObject({ entryId: 'e1', hoursX100: 250, status: 'submitted', canDecide: true });
    expect(rpc).toHaveBeenCalledWith('timesheet_count', expect.objectContaining({ p_scope: 'to_decide' }));
  });

  it('defaults to the viewer own entries', async () => {
    const { client, rpc } = clientWith(() => ({ data: [], error: null }));
    await new SupabaseTimesheetsRepository(client).list({});
    expect(rpc).toHaveBeenCalledWith('timesheet_list', expect.objectContaining({ p_scope: 'mine' }));
  });

  it('sends the decision note and maps refusals', async () => {
    const ok = clientWith(() => ({ data: null, error: null }));
    await new SupabaseTimesheetsRepository(ok.client).reject('e1', 'split it');
    expect(ok.rpc).toHaveBeenCalledWith('timesheet_reject', { p_entry_id: 'e1', p_note: 'split it' });
    const refused = clientWith(() => ({ data: null, error: { code: 'P0001', message: 'invalid_status' } }));
    await expect(new SupabaseTimesheetsRepository(refused.client).approve('e1')).rejects.toMatchObject({ code: 'invalid_status' });
    const forbidden = clientWith(() => ({ data: null, error: { code: '42501', message: 'forbidden' } }));
    await expect(new SupabaseTimesheetsRepository(forbidden.client).approve('e1')).rejects.toMatchObject({ code: 'forbidden' });
  });
});
