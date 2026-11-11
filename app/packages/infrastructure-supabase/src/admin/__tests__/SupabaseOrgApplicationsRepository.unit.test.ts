// V2-ADMIN-ORG-7, FR-ORG-002 — organization applications on the baseline table and RPCs.
import { describe, expect, it } from 'vitest';
import { BackendUnavailableError, OrgApplicationError } from '@kc/domain';
import { callsTo, createFakeClient, type FakeClientConfig } from '../../__tests__/fakeBaselineClient';
import { fail, ok } from '../../posts/__tests__/cardFixtures';
import { SupabaseOrgApplicationsRepository } from '../SupabaseOrgApplicationsRepository';

const ROW = {
  id: 'app1', applicant_id: 'u1', org_name: 'Org', org_type: 'nonprofit_association', registration_number: null,
  org_description: null, contact_email: 'org@example.com', contact_phone: null, website_url: null, declared_nonprofit: true,
  status: 'approved', reviewed_by: 'admin', reviewed_at: '2030-01-02T00:00:00Z', review_note: 'ok', organization_id: 'o1',
  created_at: '2030-01-01T00:00:00Z',
};

const repoOf = (config: FakeClientConfig) => {
  const fake = createFakeClient(config);
  return { ...fake, repo: new SupabaseOrgApplicationsRepository(fake.client) };
};

describe('SupabaseOrgApplicationsRepository — list', () => {
  it('reads the applications newest first with the applicant and reviewer names', async () => {
    const { repo, calls } = repoOf({ tables: {
      org_applications: ok([ROW, { ...ROW, id: 'app2', status: 'mystery' }]),
      users: ok([{ id: 'u1', display_name: 'Applicant' }, { id: 'admin', display_name: 'Admin' }]),
    } });
    const page = await repo.list({ status: 'approved', limit: 10 });
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({
      applicationId: 'app1', applicantName: 'Applicant', reviewerName: 'Admin', status: 'approved', reviewNote: 'ok',
    });
    expect(page.totalCount).toBe(2);
    expect(callsTo(calls, 'org_applications')[0]?.filters).toEqual([
      ['eq', 'status', 'approved'], ['order', 'created_at', { ascending: false }], ['order', 'id', { ascending: false }], ['limit', 10],
    ]);
    expect(callsTo(calls, 'users')[0]?.filters).toEqual([['in', 'id', ['u1', 'admin']]]);
  });

  it('reports a missing table and maps a refusal', async () => {
    await expect(repoOf({ tables: { org_applications: fail('PGRST205', 'nope') } }).repo.list({}))
      .rejects.toBeInstanceOf(BackendUnavailableError);
    await expect(repoOf({ tables: { org_applications: fail('42501', 'permission denied') } }).repo.list({}))
      .rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('SupabaseOrgApplicationsRepository — decisions', () => {
  it('approves at the chosen web address and rejects with a note', async () => {
    const { repo, calls } = repoOf({ rpc: { admin_org_application_approve: ok('o1') } });
    await repo.approve('app1', 'aid', null);
    await repo.reject('app1', 'no');
    expect(callsTo(calls, 'admin_org_application_approve')[0]?.args).toEqual({ p_application_id: 'app1', p_slug: 'aid', p_note: undefined });
    expect(callsTo(calls, 'admin_org_application_reject')[0]?.args).toEqual({ p_application_id: 'app1', p_note: 'no' });
  });

  it('maps the server reasons and a taken web address', async () => {
    const decided = repoOf({ rpc: { admin_org_application_approve: fail('P0001', 'application_already_decided') } });
    await expect(decided.repo.approve('app1', 'aid')).rejects.toMatchObject({ code: 'application_already_decided' });
    const taken = repoOf({ rpc: { admin_org_application_approve: fail('23505', 'duplicate key value') } });
    await expect(taken.repo.approve('app1', 'aid')).rejects.toMatchObject({ code: 'slug_taken' });
    const odd = repoOf({ rpc: { admin_org_application_reject: fail('XX000', 'boom') } });
    await expect(odd.repo.reject('app1')).rejects.toBeInstanceOf(OrgApplicationError);
  });
});
