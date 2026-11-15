// ─────────────────────────────────────────────
// SupabaseCityRepository — adapter for ICityRepository.
// Reads from `public.cities` of the baseline (select for every signed-in member; `city_id`,
// `name_he`, `name_en` — the coordinates are one `location` column the app does not read).
// ─────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ICityRepository } from '@kc/application';
import type { City } from '@kc/domain';
import { unwrapCall } from '../rpc/mapRpcError';

interface Row {
  city_id: string;
  name_he: string;
  name_en: string;
}

export class SupabaseCityRepository implements ICityRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly pageOpts: { pageSize?: number; maxPages?: number } = {},
  ) {}

  async listAll(): Promise<City[]> {
    // PostgREST `db-max-rows` is 1000 on this Supabase project, so a single
    // SELECT cannot return more than 1000 rows even with .limit(2000). The
    // seed (0008_seed_all_cities.sql) ships 1306 settlements, so without
    // pagination the list silently truncates partway through (e.g., Tel Aviv,
    // Petah Tikva disappear). We page via .range() until a short page
    // (<PAGE_SIZE) is returned. With 1306 rows + PAGE_SIZE=1000 this is two
    // round-trips, gated to <= MAX_PAGES so a misconfigured server cannot
    // loop forever. Tests may inject smaller pageOpts to keep the cap fast.
    const PAGE_SIZE = this.pageOpts.pageSize ?? 1000;
    const MAX_PAGES = this.pageOpts.maxPages ?? 10;
    const out: Row[] = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const data = unwrapCall(
        'table:cities',
        await this.client
          .from('cities')
          .select('city_id, name_he, name_en')
          .order('name_he', { ascending: true })
          .range(from, to),
      );
      const rows = (data ?? []) as Row[];
      out.push(...rows);
      if (rows.length < PAGE_SIZE) {
        return out.map((r) => ({
          cityId: r.city_id,
          nameHe: r.name_he,
          nameEn: r.name_en,
        }));
      }
    }
    throw new Error('listAll cities truncated: reached MAX_PAGES page cap');
  }
}
