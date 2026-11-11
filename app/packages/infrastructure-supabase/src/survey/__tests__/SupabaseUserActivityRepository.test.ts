import { describe, it, expect } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { createFakeClient } from '../../__tests__/fakeBaselineClient';
import { SupabaseUserActivityRepository } from '../SupabaseUserActivityRepository';

describe('SupabaseUserActivityRepository.recordActiveDay', () => {
  it('calls record_active_day without arguments', async () => {
    const { client, calls } = createFakeClient();

    await new SupabaseUserActivityRepository(client).recordActiveDay();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ kind: 'rpc', fn: 'record_active_day' });
    expect(calls[0]?.args).toBeUndefined();
  });

  it('throws SurveyError(network) when the RPC fails', async () => {
    const { client } = createFakeClient({ rpc: { record_active_day: { data: null, error: { message: 'timeout' } } } });

    await expect(new SupabaseUserActivityRepository(client).recordActiveDay()).rejects.toMatchObject({
      code: 'network',
    });
  });
});

describe('SupabaseUserActivityRepository.recordActiveDay — degrade', () => {
  it('lets a missing record_active_day reach the degrade rule instead of a survey error', async () => {
    const { client } = createFakeClient({
      rpc: { record_active_day: { data: null, error: { code: 'PGRST202', message: 'not found' } } },
    });

    await expect(new SupabaseUserActivityRepository(client).recordActiveDay()).rejects.toBeInstanceOf(
      BackendUnavailableError,
    );
  });
});
