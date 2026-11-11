// FR-RIDE-041 — adapter for IDriverDeclarationRepository.
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  DriverDeclaration,
  IDriverDeclarationRepository,
} from '@kc/application';
import { RideError } from '@kc/domain';
import type { Database } from '../database.legacy.types';

type Row = Database['public']['Tables']['driver_declarations']['Row'];

function map(row: Row): DriverDeclaration {
  return {
    userId: row.user_id,
    declaredAt: row.declared_at,
    licenseDeclared: row.license_declared,
    insuranceDeclared: row.insurance_declared,
    noProfitAcknowledged: row.no_profit_acknowledged,
  };
}

export class SupabaseDriverDeclarationRepository implements IDriverDeclarationRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async getMine(): Promise<DriverDeclaration | null> {
    const { data: auth } = await this.client.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) throw new RideError('auth_required', 'auth_required');
    const { data, error } = await this.client
      .from('driver_declarations')
      .select('*')
      .eq('user_id', uid)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? map(data as Row) : null;
  }

  async accept(): Promise<DriverDeclaration> {
    const { data: auth } = await this.client.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) throw new RideError('auth_required', 'auth_required');
    // Upsert-ish: check then insert (UPDATE is revoked, so we can't ON
    // CONFLICT DO UPDATE; the row is one-time and never changes).
    const existing = await this.getMine();
    if (existing) return existing;
    const { data, error } = await this.client
      .from('driver_declarations')
      .insert({
        user_id: uid,
        license_declared: true,
        insurance_declared: true,
        no_profit_acknowledged: true,
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return map(data as Row);
  }
}
