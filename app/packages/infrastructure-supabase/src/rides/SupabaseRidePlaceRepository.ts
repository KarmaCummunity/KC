import type { SupabaseClient } from '@supabase/supabase-js';
import type { RidePlace } from '@kc/domain';
import type { IRidePlaceRepository } from '@kc/application';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { parseWkbPoint } from '../posts/postMapPoint';

type Client = SupabaseClient<Database>;
type CityRow = Pick<Database['public']['Tables']['cities']['Row'], 'city_id' | 'name_he' | 'location'>;
type JunctionRow = Pick<Database['public']['Tables']['road_junctions']['Row'], 'junction_id' | 'name_he' | 'location'>;

/** Page size and page cap of a catalog read; tests inject smaller values. */
export type RidePlacePageOptions = { pageSize?: number; maxPages?: number };

/**
 * Official ride places (docs/spec/05_giving_worlds.md §5.3, D71) read from the `cities` and
 * `road_junctions` catalogs. The picker filters the whole list on the device, so the repository
 * returns every place with a position, cities first, each catalog in name order.
 */
export class SupabaseRidePlaceRepository implements IRidePlaceRepository {
  constructor(
    private readonly client: Client,
    private readonly pageOpts: RidePlacePageOptions = {},
  ) {}

  async listPlaces(): Promise<RidePlace[]> {
    const [cities, junctions] = await Promise.all([
      this.readAll<CityRow>('cities', 'city_id, name_he, location', 'name_he'),
      this.readAll<JunctionRow>('road_junctions', 'junction_id, name_he, location', 'name_he'),
    ]);
    return [...cities.flatMap(mapCity), ...junctions.flatMap(mapJunction)];
  }

  /**
   * PostgREST caps one response at 1,000 rows and the catalogs hold more, so a single call would
   * silently lose the tail. Read in `.range()` pages until a short page arrives, and stop at the
   * page cap so a misbehaving server cannot loop forever.
   */
  private async readAll<Row>(table: 'cities' | 'road_junctions', columns: string, order: string): Promise<Row[]> {
    const size = this.pageOpts.pageSize ?? 1000;
    const maxPages = this.pageOpts.maxPages ?? 10;
    const rows: Row[] = [];
    for (let page = 0; page < maxPages; page += 1) {
      const data = unwrapCall(
        `table:${table}`,
        await this.client
          .from(table)
          .select(columns)
          .order(order)
          .range(page * size, page * size + size - 1),
      ) as unknown as Row[] | null;
      rows.push(...(data ?? []));
      if ((data?.length ?? 0) < size) return rows;
    }
    throw new RangeError(`${table} catalog truncated: reached the page cap`);
  }
}

/** A city with a centre as a place; a city without one cannot be placed on a route and is dropped. */
function mapCity(row: CityRow): RidePlace[] {
  const point = parseWkbPoint(row.location);
  return point ? [{ kind: 'city', id: row.city_id, label: row.name_he, lat: point.lat, lng: point.lng, cityId: row.city_id }] : [];
}

/** A junction as a place; a junction belongs to no city. */
function mapJunction(row: JunctionRow): RidePlace[] {
  const point = parseWkbPoint(row.location);
  return point
    ? [{ kind: 'junction', id: String(row.junction_id), label: row.name_he, lat: point.lat, lng: point.lng, cityId: null }]
    : [];
}
