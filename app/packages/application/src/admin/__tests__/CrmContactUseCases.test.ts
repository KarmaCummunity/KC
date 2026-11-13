import { describe, expect, it, vi } from 'vitest';
import { CrmContactError } from '@kc/domain';
import { DeleteCrmContactUseCase } from '../DeleteCrmContactUseCase';
import { ListCrmContactsUseCase, ListCrmOrgsUseCase } from '../ListCrmContactsUseCase';
import { MarkCrmContactContactedUseCase } from '../MarkCrmContactContactedUseCase';
import { UpsertCrmContactUseCase } from '../UpsertCrmContactUseCase';
import type { ICrmContactsRepository } from '../ICrmContactsRepository';

function makeRepo(): ICrmContactsRepository & {
  listOrgs:        ReturnType<typeof vi.fn>;
  list:            ReturnType<typeof vi.fn>;
  upsert:          ReturnType<typeof vi.fn>;
  delete:          ReturnType<typeof vi.fn>;
  markContacted:   ReturnType<typeof vi.fn>;
} {
  return {
    listOrgs:        vi.fn(async () => []),
    list:            vi.fn(async () => ({ rows: [], totalCount: 0, nextCursor: null })),
    upsert:          vi.fn(async () => 'new-id'),
    delete:          vi.fn(async () => undefined),
    markContacted:   vi.fn(async () => undefined),
  };
}

describe('CRM use cases — delegate to repo', () => {
  it('Delete forwards the id', async () => {
    const repo = makeRepo();
    await new DeleteCrmContactUseCase(repo).execute('c1');
    expect(repo.delete).toHaveBeenCalledWith('c1');
  });

  it('List forwards filters and returns the page', async () => {
    const repo = makeRepo();
    const page = { rows: [], totalCount: 9, nextCursor: null };
    repo.list.mockResolvedValueOnce(page);
    const out = await new ListCrmContactsUseCase(repo).execute({ orgId: 'o1', status: 'warm', limit: 25 });
    expect(repo.list).toHaveBeenCalledWith({ orgId: 'o1', status: 'warm', limit: 25 });
    expect(out).toBe(page);
  });

  it('ListOrgs returns the organizations the viewer manages', async () => {
    const repo = makeRepo();
    const orgs = [{ orgId: 'o1', name: 'Karma Community', isPlatform: true }];
    repo.listOrgs.mockResolvedValueOnce(orgs);
    expect(await new ListCrmOrgsUseCase(repo).execute()).toBe(orgs);
  });

  it('MarkContacted forwards the id', async () => {
    const repo = makeRepo();
    await new MarkCrmContactContactedUseCase(repo).execute('c2');
    expect(repo.markContacted).toHaveBeenCalledWith('c2');
  });
});

describe('UpsertCrmContactUseCase', () => {
  it('rejects creation when name is missing', async () => {
    const repo = makeRepo();
    await expect(new UpsertCrmContactUseCase(repo).execute({ orgId: 'o1' }))
      .rejects.toBeInstanceOf(CrmContactError);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('rejects creation when name is blank', async () => {
    const repo = makeRepo();
    await expect(new UpsertCrmContactUseCase(repo).execute({ orgId: 'o1', name: '   ' }))
      .rejects.toBeInstanceOf(CrmContactError);
  });

  it('forwards the input to the repo when valid', async () => {
    const repo = makeRepo();
    const input = { orgId: 'o1', name: 'Alice', email: 'alice@example.com' };
    const out = await new UpsertCrmContactUseCase(repo).execute(input);
    expect(repo.upsert).toHaveBeenCalledWith(input);
    expect(out).toBe('new-id');
  });

  it('allows updates without a name (existing contactId)', async () => {
    const repo = makeRepo();
    const input = { orgId: 'o1', contactId: 'c1', notes: 'updated' };
    await new UpsertCrmContactUseCase(repo).execute(input);
    expect(repo.upsert).toHaveBeenCalledWith(input);
  });
});
