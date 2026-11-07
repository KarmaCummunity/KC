// FR-DONATE-001 AC8: the Donations hub order follows what this member opens. Each world keeps a
// time-decayed visit score (an exponential moving sum: every visit adds 1, older visits fade with
// a half-life), so recent habits outrank old ones and a world left alone drifts back down.

/** A visit counts half as much after this long. */
export const WORLD_AFFINITY_HALF_LIFE_DAYS = 14;
const DAY_MS = 86_400_000;

export interface WorldAffinityEntry {
  readonly score: number;
  /** Epoch ms when `score` was last brought up to date. */
  readonly at: number;
}

/** Visit scores by world key (the hub tile key). */
export type WorldAffinity = Readonly<Record<string, WorldAffinityEntry>>;

/** The entry's score decayed to `now`; 0 for a world never visited. */
export function worldAffinityScore(entry: WorldAffinityEntry | undefined, now: number): number {
  if (!entry || !Number.isFinite(entry.score) || entry.score <= 0) return 0;
  const elapsedDays = Math.max(0, now - entry.at) / DAY_MS;
  return entry.score * 0.5 ** (elapsedDays / WORLD_AFFINITY_HALF_LIFE_DAYS);
}

/** The scores after one visit to `world` at `now`. */
export function recordWorldVisit(affinity: WorldAffinity, world: string, now: number): WorldAffinity {
  return { ...affinity, [world]: { score: worldAffinityScore(affinity[world], now) + 1, at: now } };
}

/**
 * The hub order: active worlds before portal worlds, each group by decayed score (highest first);
 * equal scores keep the given order, so a member with no history sees the canonical order.
 */
export function orderWorldsByAffinity<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  isPortal: (item: T) => boolean,
  affinity: WorldAffinity,
  now: number,
): T[] {
  return items
    .map((item, index) => ({ item, index, portal: isPortal(item), score: worldAffinityScore(affinity[keyOf(item)], now) }))
    .sort((a, b) => Number(a.portal) - Number(b.portal) || b.score - a.score || a.index - b.index)
    .map((r) => r.item);
}

/** Reads stored scores defensively: anything malformed is dropped, never thrown. */
export function parseWorldAffinity(raw: unknown): WorldAffinity {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, WorldAffinityEntry> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const v = value as Partial<WorldAffinityEntry> | null;
    if (v && typeof v.score === 'number' && typeof v.at === 'number' && Number.isFinite(v.score) && Number.isFinite(v.at)) {
      out[key] = { score: v.score, at: v.at };
    }
  }
  return out;
}
