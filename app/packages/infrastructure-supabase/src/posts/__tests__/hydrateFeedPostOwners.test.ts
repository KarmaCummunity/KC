import { describe, expect, it, vi } from 'vitest';
import type { PostWithOwner } from '@kc/application';
import { hydrateFeedPostOwners } from '../hydrateFeedPostOwners';

const base = {
  postId: 'p1',
  ownerId: 'u1',
  ownerName: null,
  ownerHandle: '',
  ownerAvatarUrl: null,
  ownerPrivacyMode: 'Public',
  recipientUser: null,
  distanceKm: null,
} as unknown as PostWithOwner;

describe('hydrateFeedPostOwners', () => {
  it('fills owner fields from users_public when the embed was empty', async () => {
    const from = vi.fn().mockReturnValue({
      select: () => ({
        in: () =>
          Promise.resolve({
            data: [
              {
                user_id: 'u1',
                display_name: 'דנה כהן',
                share_handle: 'dana',
                avatar_url: null,
                privacy_mode: 'Public',
                verification_level: 2,
              },
            ],
            error: null,
          }),
      }),
    });
    const client = { from } as never;
    const out = await hydrateFeedPostOwners(client, [base]);
    expect(out[0]?.ownerName).toBe('דנה כהן');
    expect(out[0]?.ownerHandle).toBe('dana');
    expect(out[0]?.ownerVerificationLevel).toBe(2);
    expect(from).toHaveBeenCalledWith('users_public');
  });

  it('skips lookup when owners are already resolved', async () => {
    const from = vi.fn();
    const client = { from } as never;
    const post = { ...base, ownerName: 'יש שם', ownerHandle: 'y' };
    await hydrateFeedPostOwners(client, [post]);
    expect(from).not.toHaveBeenCalled();
  });
});
