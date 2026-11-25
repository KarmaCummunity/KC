import { describe, expect, it, vi } from 'vitest';
import { ListGuestProfilePostsUseCase } from '../ListGuestProfilePostsUseCase';
import type { IGuestProfileRepository } from '../../ports/IGuestProfileRepository';

describe('ListGuestProfilePostsUseCase', () => {
  it('strips @ and forwards the before-id cursor', async () => {
    const listPosts = vi.fn(async () => []);
    const uc = new ListGuestProfilePostsUseCase({ listPosts } as unknown as IGuestProfileRepository);
    await uc.execute('  @alice ', '40000000-0000-4000-8000-000000000001');
    expect(listPosts).toHaveBeenCalledWith('alice', '40000000-0000-4000-8000-000000000001');
  });

  it('returns an empty page for a blank handle without calling the port', async () => {
    const listPosts = vi.fn();
    const uc = new ListGuestProfilePostsUseCase({ listPosts } as unknown as IGuestProfileRepository);
    expect(await uc.execute('   ')).toEqual([]);
    expect(listPosts).not.toHaveBeenCalled();
  });
});
