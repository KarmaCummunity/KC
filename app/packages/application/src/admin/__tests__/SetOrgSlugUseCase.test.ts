import { describe, expect, it, vi } from 'vitest';
import { OrgHierarchyError } from '@kc/domain';
import { SetOrgSlugUseCase } from '../SetOrgSlugUseCase';
import type { IOrgHierarchyRepository } from '../IOrgHierarchyRepository';

function repo(): IOrgHierarchyRepository & { setOrgSlug: ReturnType<typeof vi.fn> } {
  return {
    getOrgTree: vi.fn(),
    setManager: vi.fn(),
    getHierarchyCensus: vi.fn(),
    setOrgSlug: vi.fn(async (_orgId: string, slug: string) => slug),
  };
}

describe('SetOrgSlugUseCase', () => {
  it('normalizes the slug and returns what the server stored', async () => {
    const r = repo();
    expect(await new SetOrgSlugUseCase(r).execute({ orgId: 'o1', slug: '  Aid-Israel ' })).toBe('aid-israel');
    expect(r.setOrgSlug).toHaveBeenCalledWith('o1', 'aid-israel');
  });

  it('refuses a slug that breaks the rule before any call', async () => {
    const r = repo();
    const failure = await new SetOrgSlugUseCase(r).execute({ orgId: 'o1', slug: 'two words' }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(OrgHierarchyError);
    expect(failure).toMatchObject({ code: 'invalid_slug' });
    await expect(new SetOrgSlugUseCase(r).execute({ orgId: '', slug: 'fine' })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(r.setOrgSlug).not.toHaveBeenCalled();
  });

  it('passes a server refusal through', async () => {
    const r = repo();
    r.setOrgSlug.mockRejectedValueOnce(new OrgHierarchyError('slug_taken'));
    await expect(new SetOrgSlugUseCase(r).execute({ orgId: 'o1', slug: 'help' })).rejects.toMatchObject({ code: 'slug_taken' });
  });
});
