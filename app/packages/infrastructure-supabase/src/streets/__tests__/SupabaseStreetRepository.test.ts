import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BackendUnavailableError } from '@kc/domain';
import { SupabaseStreetRepository } from '../SupabaseStreetRepository';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface FromCall {
  table: string;
  select?: string;
  eq?: { column: string; value: unknown };
  orders: { column: string; ascending: boolean }[];
  range?: { from: number; to: number };
}

function makeFakeClient(opts: {
  data?: unknown[];
  error?: { code?: string; message: string } | null;
}): { client: SupabaseClient<any>; calls: FromCall[] } {
  const calls: FromCall[] = [];
  const all = opts.data;
  const client = {
    from: (table: string) => {
      const call: FromCall = { table, orders: [] };
      calls.push(call);
      const chain = {
        select: (cols: string) => {
          call.select = cols;
          return chain;
        },
        eq: (column: string, value: unknown) => {
          call.eq = { column, value };
          return chain;
        },
        order: (column: string, opt: { ascending: boolean }) => {
          call.orders.push({ column, ascending: opt.ascending });
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

describe('SupabaseStreetRepository', () => {
  describe('listByCity', () => {
    it('queries streets for the given city_id, sorted by name_he asc with street_id tie-break', async () => {
      const { client, calls } = makeFakeClient({ data: [] });
      const repo = new SupabaseStreetRepository(client);

      await repo.listByCity('5000');

      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0]?.table).toBe('streets');
      expect(calls[0]?.select).toBe('city_id, street_id, name_he');
      expect(calls[0]?.eq).toEqual({ column: 'city_id', value: '5000' });
      expect(calls[0]?.orders).toEqual([
        { column: 'name_he', ascending: true },
        { column: 'street_id', ascending: true },
      ]);
    });

    it('maps rows from snake_case to camelCase Street entities', async () => {
      const { client } = makeFakeClient({
        data: [
          { city_id: '5000', street_id: 123, name_he: 'אלנבי' },
          { city_id: '5000', street_id: 456, name_he: 'בן יהודה' },
        ],
      });
      const repo = new SupabaseStreetRepository(client);

      const out = await repo.listByCity('5000');

      expect(out).toEqual([
        { cityId: '5000', streetId: 123, nameHe: 'אלנבי' },
        { cityId: '5000', streetId: 456, nameHe: 'בן יהודה' },
      ]);
    });

    it('returns [] when the city has no streets in the table', async () => {
      const { client } = makeFakeClient({ data: [] });
      const repo = new SupabaseStreetRepository(client);
      expect(await repo.listByCity('3729')).toEqual([]);
    });

    it('returns [] when the response data is null (defensive coalesce)', async () => {
      const { client } = makeFakeClient({ data: undefined });
      const repo = new SupabaseStreetRepository(client);
      expect(await repo.listByCity('5000')).toEqual([]);
    });

    it('preserves the order returned by the database (no client-side re-sort)', async () => {
      const { client } = makeFakeClient({
        data: [
          { city_id: '5000', street_id: 2, name_he: 'ב' },
          { city_id: '5000', street_id: 1, name_he: 'א' },
        ],
      });
      const repo = new SupabaseStreetRepository(client);
      const out = await repo.listByCity('5000');
      expect(out.map((s) => s.streetId)).toEqual([2, 1]);
    });

    it('throws the database message when the response carries an error', async () => {
      const { client } = makeFakeClient({
        data: [],
        error: { message: 'connection reset by peer' },
      });
      const repo = new SupabaseStreetRepository(client);

      await expect(repo.listByCity('5000')).rejects.toThrow('connection reset by peer');
    });

    it('throws even when the error object carries an empty message', async () => {
      const { client } = makeFakeClient({
        data: [],
        error: { message: '' },
      });
      const repo = new SupabaseStreetRepository(client);

      await expect(repo.listByCity('5000')).rejects.toThrow();
    });

    it('reports a missing streets table as BackendUnavailableError', async () => {
      const { client } = makeFakeClient({
        data: [],
        error: { code: 'PGRST205', message: 'Could not find the table public.streets' },
      });

      await expect(new SupabaseStreetRepository(client).listByCity('IL-001')).rejects.toBeInstanceOf(
        BackendUnavailableError,
      );
    });

    it('passes the cityId through verbatim (no implicit casting / trimming)', async () => {
      const { client, calls } = makeFakeClient({ data: [] });
      const repo = new SupabaseStreetRepository(client);
      await repo.listByCity('  9999  ');
      expect(calls[0]?.eq).toEqual({ column: 'city_id', value: '  9999  ' });
    });

    it('paginates with .range(from, to) in 1000-row pages — Jerusalem (4384 rows) takes 5 round trips', async () => {
      // PostgREST db-max-rows is 1000 server-side, so a single SELECT cannot
      // return Jerusalem's 4384 rows. The repo must page via .range() until
      // a short page stops the loop.
      const data = Array.from({ length: 4384 }, (_, i) => ({
        city_id: '3000',
        street_id: i + 1,
        name_he: `r${i + 1}`,
      }));
      const { client, calls } = makeFakeClient({ data });
      const repo = new SupabaseStreetRepository(client);

      const out = await repo.listByCity('3000');

      expect(calls).toHaveLength(5);
      expect(calls[0]?.range).toEqual({ from: 0, to: 999 });
      expect(calls[1]?.range).toEqual({ from: 1000, to: 1999 });
      expect(calls[2]?.range).toEqual({ from: 2000, to: 2999 });
      expect(calls[3]?.range).toEqual({ from: 3000, to: 3999 });
      expect(calls[4]?.range).toEqual({ from: 4000, to: 4999 });
      expect(out).toHaveLength(4384);
    });

    it('stops paginating after a short page (<PAGE_SIZE) is returned', async () => {
      // Tel Aviv-style: 2768 rows → 3 pages (1000, 1000, 768 short).
      const data = Array.from({ length: 2768 }, (_, i) => ({
        city_id: '5000',
        street_id: i + 1,
        name_he: `r${i + 1}`,
      }));
      const { client, calls } = makeFakeClient({ data });
      const repo = new SupabaseStreetRepository(client);

      const out = await repo.listByCity('5000');

      expect(calls).toHaveLength(3);
      expect(out).toHaveLength(2768);
    });

    it('exits after a single round trip when the first page is short (e.g., a kibbutz with one sentinel row)', async () => {
      const data = [{ city_id: '3729', street_id: 9000, name_he: 'כדים' }];
      const { client, calls } = makeFakeClient({ data });
      const repo = new SupabaseStreetRepository(client);

      const out = await repo.listByCity('3729');

      expect(calls).toHaveLength(1);
      expect(out).toEqual([{ cityId: '3729', streetId: 9000, nameHe: 'כדים' }]);
    });

    it('throws when MAX_PAGES is exhausted without a short page (truncation guard)', async () => {
      const pageSize = 5;
      const maxPages = 3;
      const data = Array.from({ length: pageSize * maxPages + 1 }, (_, i) => ({
        city_id: '5000',
        street_id: i + 1,
        name_he: `r${i + 1}`,
      }));
      const { client, calls } = makeFakeClient({ data });
      const repo = new SupabaseStreetRepository(client, { pageSize, maxPages });

      await expect(repo.listByCity('5000')).rejects.toThrow(
        'listByCity streets truncated: reached MAX_PAGES page cap',
      );

      expect(calls.length).toBe(maxPages);
    });
  });
});
