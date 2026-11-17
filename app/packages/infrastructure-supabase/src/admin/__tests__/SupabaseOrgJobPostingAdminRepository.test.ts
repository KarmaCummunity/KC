import { describe, expect, it } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient } from '../../__tests__/fakeBaselineClient';
import { fail, ok } from '../../posts/__tests__/cardFixtures';
import { SupabaseOrgJobPostingAdminRepository } from '../SupabaseOrgJobPostingAdminRepository';

describe('SupabaseOrgJobPostingAdminRepository (§5.11, #1476)', () => {
  it('lists every organization with its job-posting switch', async () => {
    const { client } = createFakeClient({
      tables: {
        organizations: ok([
          { id: 'kc', name: 'Karma Community', is_platform: true, status: 'active', may_post_jobs: false },
          { id: 'o1', name: 'Shelter', is_platform: false, status: 'suspended', may_post_jobs: true },
        ]),
      },
    });
    expect(await new SupabaseOrgJobPostingAdminRepository(client).listOrganizations()).toEqual([
      { orgId: 'kc', name: 'Karma Community', isPlatform: true, isActive: true, mayPostJobs: false },
      { orgId: 'o1', name: 'Shelter', isPlatform: false, isActive: false, mayPostJobs: true },
    ]);
  });

  it('switches an organization through admin_set_org_may_post_jobs', async () => {
    const { client, calls } = createFakeClient({ rpc: { admin_set_org_may_post_jobs: ok(null) } });
    await new SupabaseOrgJobPostingAdminRepository(client).setMayPostJobs('o1', true);
    expect(callsTo(calls, 'admin_set_org_may_post_jobs')[0]?.args).toEqual({ p_org_id: 'o1', p_enabled: true });
  });

  it('rejects when the server refuses the caller, and degrades when the function is missing', async () => {
    const forbidden = createFakeClient({ rpc: { admin_set_org_may_post_jobs: fail('42501', 'forbidden') } });
    await expect(new SupabaseOrgJobPostingAdminRepository(forbidden.client).setMayPostJobs('o1', true)).rejects.toThrow();
    const missing = createFakeClient({ rpc: { admin_set_org_may_post_jobs: fail('PGRST202', 'nope') } });
    await expect(new SupabaseOrgJobPostingAdminRepository(missing.client).setMayPostJobs('o1', true))
      .rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
