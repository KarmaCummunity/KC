// The feature switches in `public.app_flags`, read as the signed-in member.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FeatureFlagStates, IFeatureFlagsRepository } from '@kc/application';
import type { Database } from '../database.types';

export class SupabaseFeatureFlagsRepository implements IFeatureFlagsRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async listFlags(): Promise<FeatureFlagStates> {
    const { data, error } = await this.client.from('app_flags').select('key, enabled');
    // A failed read must not look like "no flags": the caller treats an error as "not loaded".
    if (error) throw new Error(`app_flags read failed: ${error.message}`);
    return Object.fromEntries((data ?? []).map((row) => [row.key, row.enabled]));
  }
}
