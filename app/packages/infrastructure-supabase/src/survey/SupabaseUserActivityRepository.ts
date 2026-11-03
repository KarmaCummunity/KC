// SupabaseUserActivityRepository — adapter for IUserActivityRepository (KC#1058).
// Active days feed the survey prompt gate and the PMF report, so failures surface as
// SurveyError('network'); callers treat them as non-critical.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IUserActivityRepository } from '@kc/application';
import { SurveyError } from '@kc/domain';
import type { Database } from '../database.types';

export class SupabaseUserActivityRepository implements IUserActivityRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async recordActiveDay(): Promise<void> {
    const { error } = await this.client.rpc('rpc_record_active_day');
    if (error) throw new SurveyError('network', error.message);
  }
}
