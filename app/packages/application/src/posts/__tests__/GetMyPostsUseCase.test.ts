import { describe, it, expect } from 'vitest';
import { GetMyPostsUseCase } from '../GetMyPostsUseCase';
import { FakePostRepository } from './fakePostRepository';

describe('GetMyPostsUseCase', () => {
  it('forwards userId / status / limit / cursor', async () => {
    const repo = new FakePostRepository();
    const uc = new GetMyPostsUseCase(repo);

    await uc.execute({ userId: 'u_1', status: ['open'], limit: 50, cursor: 'cur' });

    expect(repo.lastGetMyPostsArgs).toEqual({
      userId: 'u_1',
      status: ['open'],
      limit: 50,
      cursor: 'cur',
      visibility: undefined,
      excludeVisibility: undefined,
    });
  });

  it('forwards visibility filters to the repo', async () => {
    const repo = new FakePostRepository();
    const uc = new GetMyPostsUseCase(repo);

    await uc.execute({
      userId: 'u_1',
      status: ['open'],
      excludeVisibility: 'OnlyMe',
    });
    expect(repo.lastGetMyPostsArgs?.excludeVisibility).toBe('OnlyMe');

    await uc.execute({
      userId: 'u_1',
      status: ['open'],
      visibility: 'OnlyMe',
    });
    expect(repo.lastGetMyPostsArgs?.visibility).toBe('OnlyMe');
  });

  it('clamps limit to [1, 100]; defaults to 20', async () => {
    const repo = new FakePostRepository();
    const uc = new GetMyPostsUseCase(repo);

    await uc.execute({ userId: 'u_1', status: ['open'], limit: 0 });
    expect(repo.lastGetMyPostsArgs?.limit).toBe(1);

    await uc.execute({ userId: 'u_1', status: ['open'], limit: 999 });
    expect(repo.lastGetMyPostsArgs?.limit).toBe(100);

    await uc.execute({ userId: 'u_1', status: ['open'] });
    expect(repo.lastGetMyPostsArgs?.limit).toBe(20);
  });

  it('rejects empty status array with typed PostError (message preserved)', async () => {
    const repo = new FakePostRepository();
    const uc = new GetMyPostsUseCase(repo);
    await expect(uc.execute({ userId: 'u_1', status: [] })).rejects.toMatchObject({
      name: 'PostError',
      code: 'forbidden',
      message: 'GetMyPostsUseCase: status must include at least one value',
    });
  });

  it('forwards nextCursor from the repo (audit §3.10)', async () => {
    const repo = new FakePostRepository();
    repo.myPostsNextCursor = 'eyJjcmVhdGVkQXQiOiIyMDI2In0=';
    const uc = new GetMyPostsUseCase(repo);

    const out = await uc.execute({ userId: 'u_1', status: ['open'] });

    expect(out.nextCursor).toBe('eyJjcmVhdGVkQXQiOiIyMDI2In0=');
  });

  it('returns nextCursor=null when there are no more pages', async () => {
    const repo = new FakePostRepository();
    const uc = new GetMyPostsUseCase(repo);

    const out = await uc.execute({ userId: 'u_1', status: ['open'] });

    expect(out.nextCursor).toBeNull();
  });
});
