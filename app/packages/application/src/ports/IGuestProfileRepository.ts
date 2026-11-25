import type { GuestPost } from './IGuestPostsRepository';

/** Public fields of an active Public member — no id, contact or account state. */
export interface GuestProfile {
  readonly shareHandle: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly biography: string | null;
  readonly cityNameHe: string | null;
  readonly cityNameEn: string | null;
  readonly verificationLevel: number;
  readonly followersCount: number;
  readonly followingCount: number;
  readonly itemsGivenCount: number;
  readonly itemsReceivedCount: number;
  readonly openPostsCount: number;
}

export interface IGuestProfileRepository {
  /** `null` when the handle is private, inactive or unknown — same empty for all misses. */
  getByHandle(shareHandle: string): Promise<GuestProfile | null>;
  listPosts(shareHandle: string, beforeId?: string): Promise<readonly GuestPost[]>;
}
