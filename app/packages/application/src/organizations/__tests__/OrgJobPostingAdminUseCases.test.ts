import { describe, expect, it } from 'vitest';
import { ValidationError } from '@kc/domain';
import type { IOrgJobPostingAdminRepository, OrgJobPostingRow } from '../../ports/IOrgJobPostingAdminRepository';
import { ListOrgJobPostingUseCase, SetOrgMayPostJobsUseCase } from '../OrgJobPostingAdminUseCases';

const ROW: OrgJobPostingRow = { orgId: 'o1', name: 'Employer', isPlatform: false, isActive: true, mayPostJobs: false };

/** Records every write; `refuse` makes the next write fail as the server would for a non-admin. */
function fakeRepo(refuse = false) {
  const writes: Array<[string, boolean]> = [];
  const repo: IOrgJobPostingAdminRepository = {
    async listOrganizations() {
      return [ROW];
    },
    async setMayPostJobs(orgId, enabled) {
      if (refuse) throw new Error('forbidden');
      writes.push([orgId, enabled]);
    },
  };
  return { repo, writes };
}

describe('organization job posting (§5.11, #1476)', () => {
  it('lists the organizations with their switch', async () => {
    expect(await new ListOrgJobPostingUseCase(fakeRepo().repo).execute()).toEqual([ROW]);
  });

  it('allows and stops an organization', async () => {
    const { repo, writes } = fakeRepo();
    const useCase = new SetOrgMayPostJobsUseCase(repo);
    await useCase.execute({ orgId: 'o1', enabled: true });
    await useCase.execute({ orgId: 'o1', enabled: false });
    expect(writes).toEqual([['o1', true], ['o1', false]]);
  });

  it('refuses a missing organization without calling the server', async () => {
    const { repo, writes } = fakeRepo();
    await expect(new SetOrgMayPostJobsUseCase(repo).execute({ orgId: ' ', enabled: true })).rejects.toBeInstanceOf(ValidationError);
    expect(writes).toEqual([]);
  });

  it('passes the server refusal on, so the screen can say the switch failed', async () => {
    await expect(new SetOrgMayPostJobsUseCase(fakeRepo(true).repo).execute({ orgId: 'o1', enabled: true })).rejects.toThrow('forbidden');
  });
});
