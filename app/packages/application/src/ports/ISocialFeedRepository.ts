/** What a mute hides. The baseline table knows these three; there is no per-category mute. */
export type FeedMuteFilterKind = 'user' | 'keyword' | 'world';

export interface FeedMuteFilterRow {
  filterId: string;
  filterKind: FeedMuteFilterKind;
  filterValue: string;
  createdAt: string;
}

/** The member's own feed controls: hidden posts, mute filters and impressions (KC#870). */
export interface ISocialFeedRepository {
  hidePost(postId: string): Promise<void>;
  logImpressions(postIds: string[]): Promise<void>;
  listMuteFilters(): Promise<FeedMuteFilterRow[]>;
  addMuteFilter(kind: FeedMuteFilterKind, value: string): Promise<void>;
  removeMuteFilter(filterId: string): Promise<void>;
}
