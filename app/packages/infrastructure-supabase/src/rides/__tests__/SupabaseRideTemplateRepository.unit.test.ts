import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../database.legacy.types';
import { SupabaseRideTemplateRepository } from '../SupabaseRideTemplateRepository';

/* eslint-disable @typescript-eslint/no-explicit-any */

const SAMPLE_TEMPLATE_ROW = {
  template_id: 'tmpl_1',
  owner_id: 'u_owner',
  mode: 'offer',
  origin_city_id: '5000',
  dest_city_id: '4000',
  origin_street: 'Dizengoff',
  origin_street_number: '10',
  dest_street: 'HaNassi',
  dest_street_number: null,
  depart_time: '08:30:00',
  weekday_mask: 31,
  seats_available: 3,
  description: 'Daily commute',
  visibility: 'Public',
  status: 'active',
  lookahead_days: 14,
  created_at: '2026-05-01T00:00:00Z',
  updated_at: '2026-05-01T00:00:00Z',
};

function createMockClient(overrides: {
  singleResult?: { data: any; error: any };
  maybeSingleResult?: { data: any; error: any };
  listResult?: { data: any; error: any };
  deleteResult?: { error: any };
} = {}) {
  const calls: {
    insertPayload?: any;
    updatePayload?: any;
    deleteEq?: [string, any];
    selectEq?: [string, any];
    orderArgs?: [string, any];
  } = {};

  const client = {
    from: vi.fn().mockImplementation((table: string) => {
      expect(table).toBe('ride_templates');
      return {
        insert: vi.fn().mockImplementation((payload: any) => {
          calls.insertPayload = payload;
          return {
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue(
                overrides.singleResult ?? { data: SAMPLE_TEMPLATE_ROW, error: null },
              ),
            }),
          };
        }),
        update: vi.fn().mockImplementation((payload: any) => {
          calls.updatePayload = payload;
          return {
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue(
                  overrides.singleResult ?? { data: SAMPLE_TEMPLATE_ROW, error: null },
                ),
              }),
            }),
          };
        }),
        delete: vi.fn().mockImplementation(() => {
          return {
            eq: vi.fn().mockImplementation((col: string, val: any) => {
              calls.deleteEq = [col, val];
              return Promise.resolve(overrides.deleteResult ?? { error: null });
            }),
          };
        }),
        select: vi.fn().mockImplementation(() => {
          const builder: any = {
            eq: vi.fn().mockImplementation((col: string, val: any) => {
              calls.selectEq = [col, val];
              return builder;
            }),
            order: vi.fn().mockImplementation((col: string, opts: any) => {
              calls.orderArgs = [col, opts];
              return builder;
            }),
            maybeSingle: vi.fn().mockResolvedValue(
              overrides.maybeSingleResult ?? { data: SAMPLE_TEMPLATE_ROW, error: null },
            ),
            then: (resolve: any, reject: any) => {
              const res = overrides.listResult ?? { data: [SAMPLE_TEMPLATE_ROW], error: null };
              return Promise.resolve(res).then(resolve, reject);
            },
          };
          return builder;
        }),
      };
    }),
  } as unknown as SupabaseClient<Database>;

  return { client, calls };
}

describe('SupabaseRideTemplateRepository', () => {
  describe('create', () => {
    it('inserts template row and returns mapped domain object', async () => {
      const { client, calls } = createMockClient();
      const repo = new SupabaseRideTemplateRepository(client);

      const created = await repo.create({
        ownerId: 'u_owner',
        mode: 'offer',
        originCityId: '5000',
        destCityId: '4000',
        originStreet: 'Dizengoff',
        originStreetNumber: '10',
        destStreet: 'HaNassi',
        destStreetNumber: null,
        departTime: '08:30:00',
        weekdayMask: 31,
        seatsAvailable: 3,
        description: 'Daily commute',
        visibility: 'Public',
        lookaheadDays: 14,
      });

      expect(calls.insertPayload).toEqual({
        owner_id: 'u_owner',
        mode: 'offer',
        origin_city_id: '5000',
        dest_city_id: '4000',
        origin_street: 'Dizengoff',
        origin_street_number: '10',
        dest_street: 'HaNassi',
        dest_street_number: null,
        depart_time: '08:30:00',
        weekday_mask: 31,
        seats_available: 3,
        description: 'Daily commute',
        visibility: 'Public',
        lookahead_days: 14,
      });
      expect(created.templateId).toBe('tmpl_1');
    });

    it('throws when insert returns an error', async () => {
      const { client } = createMockClient({
        singleResult: { data: null, error: { message: 'violates check constraint' } },
      });
      const repo = new SupabaseRideTemplateRepository(client);

      await expect(
        repo.create({
          ownerId: 'u_owner',
          mode: 'offer',
          originCityId: '5000',
          destCityId: '4000',
          originStreet: 'Dizengoff',
          originStreetNumber: null,
          destStreet: 'HaNassi',
          destStreetNumber: null,
          departTime: '08:30:00',
          weekdayMask: 31,
          seatsAvailable: 3,
          description: null,
          visibility: 'Public',
          lookaheadDays: 14,
        }),
      ).rejects.toThrow('violates check constraint');
    });
  });

  describe('getById', () => {
    it('returns mapped template when found', async () => {
      const { client, calls } = createMockClient();
      const repo = new SupabaseRideTemplateRepository(client);

      const template = await repo.getById('tmpl_1');
      expect(calls.selectEq).toEqual(['template_id', 'tmpl_1']);
      expect(template?.templateId).toBe('tmpl_1');
    });

    it('returns null when template not found', async () => {
      const { client } = createMockClient({
        maybeSingleResult: { data: null, error: null },
      });
      const repo = new SupabaseRideTemplateRepository(client);

      const template = await repo.getById('missing');
      expect(template).toBeNull();
    });

    it('throws when select returns an error', async () => {
      const { client } = createMockClient({
        maybeSingleResult: { data: null, error: { message: 'db error' } },
      });
      const repo = new SupabaseRideTemplateRepository(client);

      await expect(repo.getById('tmpl_1')).rejects.toThrow('db error');
    });
  });

  describe('listForOwner', () => {
    it('returns list of templates for owner ordered by created_at desc', async () => {
      const { client, calls } = createMockClient({
        listResult: { data: [SAMPLE_TEMPLATE_ROW], error: null },
      });
      const repo = new SupabaseRideTemplateRepository(client);

      const list = await repo.listForOwner('u_owner');
      expect(calls.selectEq).toEqual(['owner_id', 'u_owner']);
      expect(calls.orderArgs).toEqual(['created_at', { ascending: false }]);
      expect(list).toHaveLength(1);
      expect(list[0]?.templateId).toBe('tmpl_1');
    });

    it('returns empty array when data is null', async () => {
      const { client } = createMockClient({
        listResult: { data: null, error: null },
      });
      const repo = new SupabaseRideTemplateRepository(client);

      const list = await repo.listForOwner('u_owner');
      expect(list).toEqual([]);
    });

    it('throws when query returns an error', async () => {
      const { client } = createMockClient({
        listResult: { data: null, error: { message: 'query failed' } },
      });
      const repo = new SupabaseRideTemplateRepository(client);

      await expect(repo.listForOwner('u_owner')).rejects.toThrow('query failed');
    });
  });

  describe('setStatus', () => {
    it('updates status and returns mapped template', async () => {
      const { client, calls } = createMockClient({
        singleResult: { data: { ...SAMPLE_TEMPLATE_ROW, status: 'paused' }, error: null },
      });
      const repo = new SupabaseRideTemplateRepository(client);

      const updated = await repo.setStatus('tmpl_1', 'paused');
      expect(calls.updatePayload).toEqual({ status: 'paused' });
      expect(updated.status).toBe('paused');
    });

    it('throws when update returns an error', async () => {
      const { client } = createMockClient({
        singleResult: { data: null, error: { message: 'update failed' } },
      });
      const repo = new SupabaseRideTemplateRepository(client);

      await expect(repo.setStatus('tmpl_1', 'paused')).rejects.toThrow('update failed');
    });
  });

  describe('delete', () => {
    it('deletes template by template_id', async () => {
      const { client, calls } = createMockClient();
      const repo = new SupabaseRideTemplateRepository(client);

      await repo.delete('tmpl_1');
      expect(calls.deleteEq).toEqual(['template_id', 'tmpl_1']);
    });

    it('throws when delete returns an error', async () => {
      const { client } = createMockClient({
        deleteResult: { error: { message: 'delete failed' } },
      });
      const repo = new SupabaseRideTemplateRepository(client);

      await expect(repo.delete('tmpl_1')).rejects.toThrow('delete failed');
    });
  });
});
