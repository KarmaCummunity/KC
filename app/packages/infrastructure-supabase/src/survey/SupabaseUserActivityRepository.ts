// SupabaseUserActivityRepository — adapter for IUserActivityRepository (KC#1058).
// Active days feed the survey prompt gate and the PMF report, so failures surface as
// SurveyError('network'); callers treat them as non-critical. A backend without the function
// (BackendUnavailableError) goes to the caller's degrade rule instead.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IUserActivityRepository } from '@kc/application';
import { BackendUnavailableError, SurveyError } from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

export class SupabaseUserActivityRepository implements IUserActivityRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  /** `record_active_day`: marks the caller active for today (one row per Israel calendar day). */
  async recordActiveDay(): Promise<void> {
    try {
      unwrapCall('rpc:record_active_day', await this.client.rpc('record_active_day'));
    } catch (error) {
      if (error instanceof BackendUnavailableError) throw error;
      throw new SurveyError('network', error instanceof Error ? error.message : 'record_active_day failed');
    }
  }
}
