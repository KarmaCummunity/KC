// ─────────────────────────────────────────────
// IStreetRepository — port for the canonical Israeli street reference table.
// Mapped to SRS: FR-PROFILE-007 AC1 (city-dependent street picker).
// Adapter lives in @kc/infrastructure-supabase.
// docs/spec/requirements/02_profile_and_privacy.md
// ─────────────────────────────────────────────

import type { Street } from '@kc/domain';

export interface IStreetRepository {
  /**
   * Read every row of `public.streets` for the given city, ordered by Hebrew
   * name. Returns an empty array if the city is unknown to the streets table
   * (the picker's free-text fallback handles that case at the UI layer).
   */
  listByCity(cityId: string): Promise<Street[]>;
}
