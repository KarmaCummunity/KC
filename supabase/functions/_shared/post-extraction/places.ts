// supabase/functions/_shared/post-extraction/places.ts
// Turns the candidates of api_resolve_place into the decision of FR-IMPORT-004 AC2-AC3: one
// auto-picked place (to be confirmed) or up to three suggestions. Floors and the margin live
// here, not in SQL, so they are config of the pipeline (FR-IMPORT-006 AC5).

export type PlaceLevel = 'city' | 'street' | 'junction';

export interface PlaceCandidate {
  level: PlaceLevel;
  placeId: string;
  nameHe: string;
  cityId: string | null;
  score: number;
  margin: number;
}

/** Looks the words up in the official catalog (the api_resolve_place RPC in production). */
export type PlaceResolver = (level: PlaceLevel, text: string, cityId: string | null) => Promise<PlaceCandidate[]>;

export interface ResolvedPlace {
  /** `picked`: one clear match (confirm it); `suggest`: choose among the suggestions; `none`: nothing close. */
  status: 'picked' | 'suggest' | 'none';
  picked: PlaceCandidate | null;
  suggestions: PlaceCandidate[];
}

/** Similarity a match must reach to be picked on its own, per level (FR-IMPORT-004 AC2). */
export const PLACE_FLOORS: Record<PlaceLevel, number> = { city: 0.85, street: 0.8, junction: 0.8 };
/** The winner's lead over the runner-up needed to be picked on its own (AC3). */
export const PLACE_MARGIN = 0.1;
export const MAX_SUGGESTIONS = 3;

/** Candidates best first with their margin recomputed over this list (the catalogs were searched apart). */
function rank(candidates: PlaceCandidate[]): PlaceCandidate[] {
  const sorted = [...candidates].sort((a, b) => b.score - a.score || a.nameHe.localeCompare(b.nameHe) || a.placeId.localeCompare(b.placeId));
  return sorted.map((c, i) => ({ ...c, margin: Math.round((c.score - (sorted[i + 1]?.score ?? 0)) * 100) / 100 }));
}

/** The pick-or-suggest decision for already ranked candidates. */
export function decideFrom(ranked: PlaceCandidate[]): ResolvedPlace {
  const top = ranked[0];
  if (!top) return { status: 'none', picked: null, suggestions: [] };
  if (top.score >= PLACE_FLOORS[top.level] && top.margin >= PLACE_MARGIN) {
    return { status: 'picked', picked: top, suggestions: [] };
  }
  return { status: 'suggest', picked: null, suggestions: ranked.slice(0, MAX_SUGGESTIONS) };
}

export function decidePlace(level: PlaceLevel, candidates: PlaceCandidate[]): ResolvedPlace {
  return decideFrom(rank(candidates.filter((c) => c.level === level)));
}

/** A ride end or meeting point is a city or a named junction: both catalogs, one ranked list (D71). */
export async function resolveRidePlace(resolve: PlaceResolver, text: string | null): Promise<ResolvedPlace> {
  if (!text) return { status: 'none', picked: null, suggestions: [] };
  const [cities, junctions] = await Promise.all([resolve('city', text, null), resolve('junction', text, null)]);
  return decideFrom(rank([...cities, ...junctions]));
}
