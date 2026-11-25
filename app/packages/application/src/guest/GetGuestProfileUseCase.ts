import type { GuestProfile, IGuestProfileRepository } from '../ports/IGuestProfileRepository';

export class GetGuestProfileUseCase {
  constructor(private readonly repo: IGuestProfileRepository) {}

  execute(shareHandle: string): Promise<GuestProfile | null> {
    const handle = shareHandle.trim().replace(/^@+/, '');
    if (!handle) return Promise.resolve(null);
    return this.repo.getByHandle(handle);
  }
}
