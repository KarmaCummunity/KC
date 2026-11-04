// ─────────────────────────────────────────────
// ICityRepository — port for the Israeli-cities reference table.
// Mapped to SRS: FR-AUTH-010 AC2 (canonical city list, no free-text).
// Adapter lives in @kc/infrastructure-supabase.
// docs/spec/requirements/01_auth_and_onboarding.md
// ─────────────────────────────────────────────

import type { City } from '@kc/domain';

export interface ICityRepository {
  /** Read every row of `public.cities` ordered by Hebrew name (collated). */
  listAll(): Promise<City[]>;
}
