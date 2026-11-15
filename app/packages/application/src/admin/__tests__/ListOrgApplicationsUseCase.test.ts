import { describe, expect, it, vi } from 'vitest';
import { ListOrgApplicationsUseCase } from '../ListOrgApplicationsUseCase';
import type { IOrgApplicationsRepository } from '../IOrgApplicationsRepository';

describe('ListOrgApplicationsUseCase', () => {
  it('forwards filters to repo.list and returns the page', async () => {
    const page = { rows: [], totalCount: 7 };
    const list = vi.fn(async () => page);
    const repo = { list } as unknown as IOrgApplicationsRepository;
    const uc = new ListOrgApplicationsUseCase(repo);

    const filters = { status: 'pending' as const, limit: 25 };
    const out = await uc.execute(filters);

    expect(list).toHaveBeenCalledWith(filters);
    expect(out).toBe(page);
  });
});
