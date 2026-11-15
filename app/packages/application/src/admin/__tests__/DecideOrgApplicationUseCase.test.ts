import { describe, expect, it, vi } from 'vitest';
import { OrgApplicationError } from '@kc/domain';
import { DecideOrgApplicationUseCase } from '../DecideOrgApplicationUseCase';
import type { IOrgApplicationsRepository } from '../IOrgApplicationsRepository';

function makeRepo(): IOrgApplicationsRepository & {
  approve: ReturnType<typeof vi.fn>;
  reject: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
} {
  return {
    approve: vi.fn(async () => undefined),
    reject:  vi.fn(async () => undefined),
    list:    vi.fn(async () => ({ rows: [], totalCount: 0 })),
  };
}

describe('DecideOrgApplicationUseCase', () => {
  it('throws when applicationId is missing', async () => {
    const repo = makeRepo();
    const uc = new DecideOrgApplicationUseCase(repo);
    await expect(uc.execute({ applicationId: '', approve: true })).rejects.toBeInstanceOf(OrgApplicationError);
    expect(repo.approve).not.toHaveBeenCalled();
    expect(repo.reject).not.toHaveBeenCalled();
  });

  it('calls approve with a note when approve=true', async () => {
    const repo = makeRepo();
    const uc = new DecideOrgApplicationUseCase(repo);
    await uc.execute({ applicationId: 'a1', approve: true, slug: ' aid-for-all ', note: 'looks good' });
    expect(repo.approve).toHaveBeenCalledWith('a1', 'aid-for-all', 'looks good');
    expect(repo.reject).not.toHaveBeenCalled();
  });

  it('calls approve with null when no note is given', async () => {
    const repo = makeRepo();
    const uc = new DecideOrgApplicationUseCase(repo);
    await uc.execute({ applicationId: 'a1', approve: true, slug: 'aid' });
    expect(repo.approve).toHaveBeenCalledWith('a1', 'aid', null);
  });

  it('refuses to approve without a valid web address', async () => {
    const repo = makeRepo();
    const uc = new DecideOrgApplicationUseCase(repo);
    await expect(uc.execute({ applicationId: 'a1', approve: true })).rejects.toMatchObject({ code: 'invalid_slug' });
    await expect(uc.execute({ applicationId: 'a1', approve: true, slug: 'Aid For All' })).rejects.toMatchObject({ code: 'invalid_slug' });
    expect(repo.approve).not.toHaveBeenCalled();
  });

  it('calls reject when approve=false', async () => {
    const repo = makeRepo();
    const uc = new DecideOrgApplicationUseCase(repo);
    await uc.execute({ applicationId: 'a2', approve: false, note: 'no fit' });
    expect(repo.reject).toHaveBeenCalledWith('a2', 'no fit');
    expect(repo.approve).not.toHaveBeenCalled();
  });
});
