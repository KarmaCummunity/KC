export interface GuestPost {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly cityNameHe: string;
  readonly cityNameEn: string;
  /**
   * Public share handle when the author is Public; otherwise null.
   * Wire type is `string` (supabase gen types); runtime null is coerced here.
   */
  readonly authorShareHandle: string | null;
}

/** Deliberately separate from member PostWithOwner. No identity or account state. */
export interface IGuestPostsRepository {
  list(beforeId?: string): Promise<readonly GuestPost[]>;
  get(id: string): Promise<GuestPost | null>;
}
