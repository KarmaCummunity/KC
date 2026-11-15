import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BackendUnavailableError } from '@kc/domain';
import { SupabaseCityRepository } from '../SupabaseCityRepository';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface FromCall {
  table: string;
  select?: string;
  order?: { column: string; ascending: boolean };
  range?: { from: number; to: number };
}

/**
 * Fake client whose .range(from, to) returns the requested slice of the
 * supplied `data` array. Exposes the captured chain calls so tests can assert
 * the pagination semantics.
 */
function makeFakeClient(opts: {
  data?: unknown[];
  error?: { code?: string; message: string } | null;
}): { client: SupabaseClient<any>; calls: FromCall[] } {
  const calls: FromCall[] = [];
  const all = opts.data;
  const client = {
    from: (table: string) => {
      const call: FromCall = { table };
      calls.push(call);
      const chain = {
        select: (cols: string) => {
          call.select = cols;
          return chain;
        },
        order: (column: string, opt: { ascending: boolean }) => {
          call.order = { column, ascending: opt.ascending };
          return chain;
        },
        range: (from: number, to: number) => {
          call.range = { from, to };
          if (opts.error) {
            return Promise.resolve({ data: null, error: opts.error });
          }
          if (all === undefined) {
            return Promise.resolve({ data: null, error: null });
          }
          return Promise.resolve({
            data: all.slice(from, to + 1),
            error: null,
          });
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient<any>;
  return { client, calls };
}

describe('SupabaseCityRepository', () => {
  describe('listAll', () => {
    it('queries the cities table with city_id, name_he, name_en sorted by name_he asc', async () => {
      const { client, calls } = makeFakeClient({ data: [] });
      const repo = new SupabaseCityRepository(client);

      await repo.listAll();

      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0]?.table).toBe('cities');
      expect(calls[0]?.select).toBe('city_id, name_he, name_en');
      expect(calls[0]?.order).toEqual({ column: 'name_he', ascending: true });
    });

    it('maps rows from snake_case to camelCase City entities', async () => {
      const { client } = makeFakeClient({
        data: [
          { city_id: 'IL-001', name_he: 'תל אביב', name_en: 'Tel Aviv' },
          { city_id: 'IL-002', name_he: 'ירושלים', name_en: 'Jerusalem' },
        ],
      });
      const repo = new SupabaseCityRepository(client);

      const out = await repo.listAll();

      expect(out).toEqual([
        { cityId: 'IL-001', nameHe: 'תל אביב', nameEn: 'Tel Aviv' },
        { cityId: 'IL-002', nameHe: 'ירושלים', nameEn: 'Jerusalem' },
      ]);
    });

    it('preserves the order returned by the database', async () => {
      // The repo does not re-sort client-side — it trusts the ORDER BY in
      // the query. Verifies the mapper is a stable map(), not a re-sort.
      const { client } = makeFakeClient({
        data: [
          { city_id: 'IL-002', name_he: 'באר שבע', name_en: 'Beer Sheva' },
          { city_id: 'IL-001', name_he: 'אילת', name_en: 'Eilat' },
        ],
      });
      const repo = new SupabaseCityRepository(client);

      const out = await repo.listAll();

      expect(out.map((c) => c.cityId)).toEqual(['IL-002', 'IL-001']);
    });

    it('returns [] when the response data is an empty array', async () => {
      const { client } = makeFakeClient({ data: [] });
      const repo = new SupabaseCityRepository(client);

      expect(await repo.listAll()).toEqual([]);
    });

    it('returns [] when the response data is null (defensive coalesce)', async () => {
      // Supabase contracts: data is null when no rows match, but some
      // transport edge cases also flip data to null. The mapper guards
      // against this so callers never see a TypeError.
      const { client } = makeFakeClient({ data: undefined });
      const repo = new SupabaseCityRepository(client);

      expect(await repo.listAll()).toEqual([]);
    });

    it('throws the database message when the response carries an error', async () => {
      const { client } = makeFakeClient({
        data: [],
        error: { message: 'connection reset by peer' },
      });
      const repo = new SupabaseCityRepository(client);

      await expect(repo.listAll()).rejects.toThrow('connection reset by peer');
    });

    it('throws even when the error object carries an empty message', async () => {
      const { client } = makeFakeClient({
        data: [],
        error: { message: '' },
      });
      const repo = new SupabaseCityRepository(client);

      await expect(repo.listAll()).rejects.toThrow();
    });

    it('reports a missing cities table as BackendUnavailableError', async () => {
      const { client } = makeFakeClient({
        data: [],
        error: { code: 'PGRST205', message: 'Could not find the table public.cities' },
      });

      await expect(new SupabaseCityRepository(client).listAll()).rejects.toBeInstanceOf(BackendUnavailableError);
    });

    it('paginates with .range(from, to) in 1000-row pages to bypass server db-max-rows cap', async () => {
      // The dev/prod Supabase project enforces db-max-rows=1000 server-side,
      // so a single SELECT cannot exceed that even with .limit(2000). The
      // repo must page via .range() until a short page is returned.
      // Builds 1306 mock rows (matches production seed) and asserts the
      // pagination calls have the expected (from, to) shape.
      const data = Array.from({ length: 1306 }, (_, i) => ({
        city_id: String(i + 1),
        name_he: `עיר ${i + 1}`,
        name_en: `City ${i + 1}`,
      }));
      const { client, calls } = makeFakeClient({ data });
      const repo = new SupabaseCityRepository(client);

      await repo.listAll();

      // Expect exactly 2 calls: page 1 (0..999, full 1000) and page 2
      // (1000..1999, partial 306 — short page stops the loop).
      expect(calls).toHaveLength(2);
      expect(calls[0]?.range).toEqual({ from: 0, to: 999 });
      expect(calls[1]?.range).toEqual({ from: 1000, to: 1999 });
    });

    it('returns every row across pages — no client-side truncation (1306-row regression)', async () => {
      const data = Array.from({ length: 1306 }, (_, i) => ({
        city_id: String(i + 1),
        name_he: `עיר ${i + 1}`,
        name_en: `City ${i + 1}`,
      }));
      const { client } = makeFakeClient({ data });
      const repo = new SupabaseCityRepository(client);

      const out = await repo.listAll();

      expect(out).toHaveLength(1306);
      expect(out[0]).toEqual({ cityId: '1', nameHe: 'עיר 1', nameEn: 'City 1' });
      expect(out[1305]).toEqual({ cityId: '1306', nameHe: 'עיר 1306', nameEn: 'City 1306' });
    });

    it('stops paginating after a short page (<PAGE_SIZE) is returned', async () => {
      // 500 rows → first page is short (500 < 1000), so the loop exits
      // after a single round-trip. Guards against any future off-by-one
      // that would issue a second redundant request.
      const data = Array.from({ length: 500 }, (_, i) => ({
        city_id: String(i + 1),
        name_he: `c${i}`,
        name_en: `c${i}`,
      }));
      const { client, calls } = makeFakeClient({ data });
      const repo = new SupabaseCityRepository(client);

      const out = await repo.listAll();

      expect(out).toHaveLength(500);
      expect(calls).toHaveLength(1);
    });

    it('throws when MAX_PAGES is exhausted without a short page (truncation guard)', async () => {
      // Pathological server: every .range() returns a full page so the short-page
      // exit never triggers. Inject tiny pageOpts so the cap is fast to exercise.
      const pageSize = 5;
      const maxPages = 3;
      const data = Array.from({ length: pageSize * maxPages + 1 }, (_, i) => ({
        city_id: String(i + 1),
        name_he: `c${i}`,
        name_en: `c${i}`,
      }));
      const { client, calls } = makeFakeClient({ data });
      const repo = new SupabaseCityRepository(client, { pageSize, maxPages });

      await expect(repo.listAll()).rejects.toThrow(
        'listAll cities truncated: reached MAX_PAGES page cap',
      );

      expect(calls.length).toBe(maxPages);
    });
  });
});
