export interface GuestPost {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly cityNameHe: string;
  readonly cityNameEn: string;
}

/** Deliberately separate from member PostWithOwner. No identity or account state. */
export interface IGuestPostsRepository {
  list(beforeId?: string): Promise<readonly GuestPost[]>;
  get(id: string): Promise<GuestPost | null>;
}
