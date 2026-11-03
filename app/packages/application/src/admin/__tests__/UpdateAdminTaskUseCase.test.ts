import { describe, expect, it } from 'vitest';
import { UpdateAdminTaskUseCase } from '../UpdateAdminTaskUseCase';
import { fakeAdminTaskRepo } from './fakeAdminTaskRepo';

describe('UpdateAdminTaskUseCase', () => {
  it('passes the patch through', async () => {
    const repo = fakeAdminTaskRepo();
    const uc = new UpdateAdminTaskUseCase(repo);
    await uc.execute({ taskId: 't1', patch: { title: 'New title' } });
    expect(repo.update).toHaveBeenCalledWith('t1', { title: 'New title' });
  });

  it('throws invalid_input on empty task_id', async () => {
    const repo = fakeAdminTaskRepo();
    const uc = new UpdateAdminTaskUseCase(repo);
    await expect(uc.execute({ taskId: '', patch: {} })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('rejects whitespace-only title patches', async () => {
    const uc = new UpdateAdminTaskUseCase(fakeAdminTaskRepo());
    await expect(uc.execute({ taskId: 't1', patch: { title: '   ' } })).rejects.toMatchObject({
      code: 'invalid_title',
    });
  });

  it('rejects priority outside the allowlist', async () => {
    const uc = new UpdateAdminTaskUseCase(fakeAdminTaskRepo());
    await expect(
      // @ts-expect-error testing runtime rejection
      uc.execute({ taskId: 't1', patch: { priority: 'crit' } }),
    ).rejects.toMatchObject({ code: 'invalid_priority' });
  });

  it('rejects title longer than 200 characters', async () => {
    const uc = new UpdateAdminTaskUseCase(fakeAdminTaskRepo());
    await expect(
      uc.execute({ taskId: 't1', patch: { title: 'a'.repeat(201) } }),
    ).rejects.toMatchObject({ code: 'title_too_long' });
  });

  it('rejects category outside the allowlist', async () => {
    const uc = new UpdateAdminTaskUseCase(fakeAdminTaskRepo());
    await expect(
      // @ts-expect-error testing runtime rejection
      uc.execute({ taskId: 't1', patch: { category: 'unsupported_cat' } }),
    ).rejects.toMatchObject({ code: 'invalid_category' });
  });
});
