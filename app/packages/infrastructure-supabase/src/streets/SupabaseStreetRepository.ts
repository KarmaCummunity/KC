// ─────────────────────────────────────────────
// SupabaseStreetRepository — adapter for IStreetRepository.
// Reads from `public.streets` of the baseline (select for every signed-in member; the
// coordinates are one `location` column the app does not read).
//
// PostgREST `db-max-rows` is 1000 on this project, so a single SELECT cannot
// return more than 1000 rows. Jerusalem alone has 4,384 streets — without
// pagination the picker silently truncates mid-list. We page via .range()
// in PAGE_SIZE chunks until a short page (<PAGE_SIZE) is returned.
// ─────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IStreetRepository } from '@kc/application';
import type { Street } from '@kc/domain';
import { unwrapCall } from '../rpc/mapRpcError';

interface Row {
  city_id: string;
  street_id: number;
  name_he: string;
}

export class SupabaseStreetRepository implements IStreetRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly pageOpts: { pageSize?: number; maxPages?: number } = {},
  ) {}

  async listByCity(cityId: string): Promise<Street[]> {
    // Jerusalem (4384) needs 5 pages; cap at MAX_PAGES so a misconfigured
    // server can't loop forever. Tests may inject smaller pageOpts.
    const PAGE_SIZE = this.pageOpts.pageSize ?? 1000;
    const MAX_PAGES = this.pageOpts.maxPages ?? 10;
    const out: Row[] = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const data = unwrapCall(
        'table:streets',
        await this.client
          .from('streets')
          .select('city_id, street_id, name_he')
          .eq('city_id', cityId)
          .order('name_he', { ascending: true })
          .order('street_id', { ascending: true })
          .range(from, to),
      );
      const rows = (data ?? []) as Row[];
      out.push(...rows);
      if (rows.length < PAGE_SIZE) {
        return out.map((r) => ({
          cityId: r.city_id,
          streetId: r.street_id,
          nameHe: r.name_he,
        }));
      }
    }
    throw new Error('listByCity streets truncated: reached MAX_PAGES page cap');
  }
}
