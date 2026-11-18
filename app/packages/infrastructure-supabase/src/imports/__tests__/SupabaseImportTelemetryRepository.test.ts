// FR-IMPORT-010 AC4 — the adapter reads the import funnel and the per-field edit rates.
import { describe, expect, it } from 'vitest';
import { callsTo, createFakeClient } from '../../__tests__/fakeBaselineClient';
import { ok } from '../../posts/__tests__/cardFixtures';
import { SupabaseImportTelemetryRepository } from '../SupabaseImportTelemetryRepository';

describe('SupabaseImportTelemetryRepository', () => {
  it('maps the funnel row and asks for the window', async () => {
    const { client, calls } = createFakeClient({
      rpc: { admin_import_funnel: ok([{ attempts: 6, manual: 1, drafted: 5, published: 3, discarded: 1, provider_calls: 3 }]) },
    });
    expect(await new SupabaseImportTelemetryRepository(client).getFunnel(7)).toEqual({
      attempts: 6, manual: 1, drafted: 5, published: 3, discarded: 1, providerCalls: 3,
    });
    expect(callsTo(calls, 'admin_import_funnel')[0]?.args).toEqual({ p_days: 7 });
  });

  it('an empty answer is an empty funnel', async () => {
    const { client } = createFakeClient({ rpc: { admin_import_funnel: ok([]) } });
    expect((await new SupabaseImportTelemetryRepository(client).getFunnel(30)).attempts).toBe(0);
  });

  it('maps the edit rates; a numeric string becomes a number and no reports stay null', async () => {
    const { client } = createFakeClient({
      rpc: {
        admin_import_field_edit_rates: ok([
          { field: 'title', reported: 2, edited: 1, edit_rate: '0.50' },
          { field: 'city', reported: 0, edited: 0, edit_rate: null },
        ]),
      },
    });
    expect(await new SupabaseImportTelemetryRepository(client).getFieldEditRates(30)).toEqual([
      { field: 'title', reported: 2, edited: 1, editRate: 0.5 },
      { field: 'city', reported: 0, edited: 0, editRate: null },
    ]);
  });

  it('a refusal (not a moderator) is an error for the screen to show', async () => {
    const { client } = createFakeClient({ rpc: { admin_import_funnel: { data: null, error: { message: 'forbidden', code: '42501' } } } });
    await expect(new SupabaseImportTelemetryRepository(client).getFunnel(30)).rejects.toBeTruthy();
  });
});
