// supabase/functions/_shared/post-extraction/catalog.ts
// The place resolver of the pipeline, backed by the api_resolve_place RPC (FR-IMPORT-004).

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import type { PlaceCandidate, PlaceLevel, PlaceResolver } from './places.ts';

/** Rows asked per lookup: three suggestions plus the runner-up the margin needs. */
const CANDIDATES = 5;

interface ResolveRow {
  place_id: string;
  name_he: string;
  city_id: string | null;
  score: number;
  margin: number;
}

export function rpcPlaceResolver(client: SupabaseClient): PlaceResolver {
  return async (level: PlaceLevel, text: string, cityId: string | null): Promise<PlaceCandidate[]> => {
    const { data, error } = await client.rpc('api_resolve_place', {
      p_level: level, p_text: text, p_city_id: cityId, p_limit: CANDIDATES,
    });
    // A query the catalog refuses (too short, only symbols) simply has no candidates.
    if (error) {
      if (error.code === '22023') return [];
      throw new Error(`place resolution: ${error.message}`);
    }
    return ((data ?? []) as ResolveRow[]).map((r) => ({
      level, placeId: r.place_id, nameHe: r.name_he, cityId: r.city_id, score: Number(r.score), margin: Number(r.margin),
    }));
  };
}
