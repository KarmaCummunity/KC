// FR-ADMIN-031 — the Demo data screen's adapter over the three demo-data RPCs. They belong to a
// dev-only seed (supabase/seed/demo, installed on kc-dev by the Seed KC dev workflow), never to
// the production baseline, so the generated `Database` type does not list them and they are
// called through an untyped view of the client. Where they are not installed the adapter
// refuses with DemoDataError('not_installed').
import type { SupabaseClient } from '@supabase/supabase-js';
import type { IDemoDataRepository } from '@kc/application';
import type { DemoDataSeedResult, DemoDataStatus, DemoDataStep, DemoDataWipeResult } from '@kc/domain';
import type { Database } from '../database.types';
import type { CallResult } from '../rpc/mapRpcError';
import {
  mapDemoDataSeedResult,
  mapDemoDataStatus,
  mapDemoDataStep,
  mapDemoDataWipeResult,
  toDemoDataError,
} from './demoDataRows';

/** The client without the baseline's function list, for RPCs the baseline does not declare. */
const untyped = (client: SupabaseClient<Database>): SupabaseClient => client as unknown as SupabaseClient;

function unwrap(rpc: string, result: CallResult<unknown>): unknown {
  if (result.error) throw toDemoDataError(rpc, result.error);
  return result.data;
}

export class SupabaseDemoDataRepository implements IDemoDataRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async getStatus(): Promise<DemoDataStatus> {
    const result = await untyped(this.client).rpc('admin_demo_data_status');
    return mapDemoDataStatus(unwrap('admin_demo_data_status', result));
  }

  async wipeStep(): Promise<DemoDataStep<DemoDataWipeResult>> {
    const result = await untyped(this.client).rpc('admin_wipe_demo_data_step');
    return mapDemoDataStep(unwrap('admin_wipe_demo_data_step', result), mapDemoDataWipeResult);
  }

  async seedStep(password?: string): Promise<DemoDataStep<DemoDataSeedResult>> {
    // Without a password the argument is left out, so the server uses the saved hash.
    const args = password === undefined ? {} : { p_password: password };
    const result = await untyped(this.client).rpc('admin_seed_demo_data_step', args);
    return mapDemoDataStep(unwrap('admin_seed_demo_data_step', result), mapDemoDataSeedResult);
  }
}
