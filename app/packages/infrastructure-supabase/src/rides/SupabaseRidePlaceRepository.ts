import type { SupabaseClient } from '@supabase/supabase-js';
import { isRidePlaceKind, type RidePlace } from '@kc/domain';
import type { IRidePlaceRepository } from '@kc/application';
import type { Database } from '../database.legacy.types';

type Client = SupabaseClient<Database>;
type PlaceRow = Database['public']['Functions']['list_ride_places']['Returns'][number];

/** Page size and page cap of the catalog read; tests inject smaller values. */
export type RidePlacePageOptions = { pageSize?: number; maxPages?: number };

/** Official ride places over `list_ride_places` (0512; docs/spec/05_giving_worlds.md §5.3, D71). */
export class SupabaseRidePlaceRepository implements IRidePlaceRepository {
  constructor(
    private readonly client: Client,
    private readonly pageOpts: RidePlacePageOptions = {},
  ) {}

  /**
   * The catalog holds ~1,750 rows (1,306 cities + 449 junctions, KC#1411) while
   * PostgREST caps one response at 1,000 rows, so a single call silently loses
   * every place after the first 1,000 by label. Like the city and street
   * repositories, read it in `.range()` pages until a short page arrives, and
   * stop at MAX_PAGES so a misconfigured server cannot loop forever.
   */
  async listPlaces(): Promise<RidePlace[]> {
    const PAGE_SIZE = this.pageOpts.pageSize ?? 1000;
    const MAX_PAGES = this.pageOpts.maxPages ?? 10;
    const rows: PlaceRow[] = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const from = page * PAGE_SIZE;
      const { data, error } = await this.client.rpc('list_ride_places').range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      rows.push(...(data ?? []));
      if ((data?.length ?? 0) < PAGE_SIZE) return mapPlaceRows(rows);
    }
    throw new Error('list_ride_places truncated: reached the page cap');
  }
}

/** Maps catalog rows in order; drops unknown kinds, rows without coordinates and page-boundary repeats. */
export function mapPlaceRows(rows: readonly PlaceRow[]): RidePlace[] {
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const place = mapPlaceRow(row);
    // Two pages are two queries; a tie on the sort label can repeat a row at the boundary.
    const key = place ? `${place.kind}:${place.id}` : null;
    if (!place || !key || seen.has(key)) return [];
    seen.add(key);
    return [place];
  });
}

/** Maps one catalog row; a row of an unknown kind or without coordinates is dropped. */
export function mapPlaceRow(row: PlaceRow): RidePlace | null {
  if (!isRidePlaceKind(row.place_kind) || !Number.isFinite(row.lat) || !Number.isFinite(row.lng)) return null;
  return {
    kind: row.place_kind,
    id: row.place_id,
    label: row.label,
    lat: row.lat,
    lng: row.lng,
    cityId: row.city_id ?? null,
  };
}
