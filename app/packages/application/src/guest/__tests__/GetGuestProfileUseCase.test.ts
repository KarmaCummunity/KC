import { describe, expect, it, vi } from 'vitest';
import { GetGuestProfileUseCase } from '../GetGuestProfileUseCase';
import type { GuestProfile, IGuestProfileRepository } from '../../ports/IGuestProfileRepository';

const profile: GuestProfile = {
  shareHandle: 'alice',
  displayName: 'Alice',
  avatarUrl: null,
  biography: null,
  cityNameHe: null,
  cityNameEn: 'Lod',
  verificationLevel: 0,
  followersCount: 0,
  followingCount: 0,
  itemsGivenCount: 0,
  itemsReceivedCount: 0,
  openPostsCount: 0,
};

describe('GetGuestProfileUseCase', () => {
  it('strips @ and whitespace before calling the port', async () => {
    const getByHandle = vi.fn(async () => profile);
    const uc = new GetGuestProfileUseCase({ getByHandle } as unknown as IGuestProfileRepository);
    expect(await uc.execute('  @Alice ')).toBe(profile);
    expect(getByHandle).toHaveBeenCalledWith('Alice');
  });

  it('returns null for an empty handle without calling the port', async () => {
    const getByHandle = vi.fn();
    const uc = new GetGuestProfileUseCase({ getByHandle } as unknown as IGuestProfileRepository);
    expect(await uc.execute('   ')).toBeNull();
    expect(getByHandle).not.toHaveBeenCalled();
  });
});
