// Mapped to spec: FR-FEED-020 AC2 — the offers / requests filter of the rides world feed.
import type { CreateDirection } from './unifiedCreate/createCategories';

/** Direction filter of a world feed: both directions, or only offers / requests. */
export type WorldFeedDirection = 'all' | CreateDirection;
