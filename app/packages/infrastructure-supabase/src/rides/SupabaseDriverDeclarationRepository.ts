// FR-RIDE-041 — adapter for IDriverDeclarationRepository over the world consents.
//
// The declaration is a `user_consents` record of kind `driver_declaration`. The version in force
// and whether the caller accepted it come with `bootstrap_session()` (`consents`); accepting goes
// through `accept_world_consent`, which refuses a stale version (`consent_version_stale`).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DriverDeclaration, IDriverDeclarationRepository } from '@kc/application';
import type { Database, Json } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { requireRpcRow } from '../marketplace/rpcRow';

type Client = SupabaseClient<Database>;
type ConsentRow = Database['public']['Tables']['user_consents']['Row'];

const KIND = 'driver_declaration';

interface ConsentState {
  readonly version: number;
  readonly accepted: boolean;
}

/** The driver declaration entry of the `consents` block of the `bootstrap_session()` document. */
export function parseDeclarationState(payload: Json): ConsentState | null {
  const consents = typeof payload === 'object' && payload !== null && !Array.isArray(payload) ? payload['consents'] : null;
  const entry = typeof consents === 'object' && consents !== null && !Array.isArray(consents) ? consents[KIND] : null;
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
  const version = entry['version'];
  return typeof version === 'number' ? { version, accepted: entry['accepted'] === true } : null;
}

function map(row: Pick<ConsentRow, 'user_id' | 'version' | 'accepted_at'>): DriverDeclaration {
  return { userId: row.user_id, version: row.version, declaredAt: row.accepted_at };
}

export class SupabaseDriverDeclarationRepository implements IDriverDeclarationRepository {
  constructor(private readonly client: Client) {}

  private async state(): Promise<ConsentState | null> {
    return parseDeclarationState(unwrapCall('rpc:bootstrap_session', await this.client.rpc('bootstrap_session')));
  }

  async getMine(): Promise<DriverDeclaration | null> {
    const state = await this.state();
    if (!state?.accepted) return null;
    const row = unwrapCall(
      'table:user_consents',
      await this.client.from('user_consents').select('user_id, version, accepted_at').eq('consent_kind', KIND).eq('version', state.version).maybeSingle(),
    );
    return row ? map(row) : null;
  }

  async accept(): Promise<DriverDeclaration> {
    const state = await this.state();
    if (!state) throw new Error('bootstrap_session carries no driver declaration consent');
    if (state.accepted) {
      const existing = await this.getMine();
      if (existing) return existing;
    }
    return map(
      requireRpcRow(
        unwrapCall('rpc:accept_world_consent', await this.client.rpc('accept_world_consent', { p_kind: KIND, p_version: state.version })),
        'accept_world_consent',
      ),
    );
  }
}
