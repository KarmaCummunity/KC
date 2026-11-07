// FR-FIN-022 — ports for live public transparency.
// Reading is public (guests included); the settings port is admin-only.
import type { OrgTransparency, TransparencySettings, TransparencyToggle } from '@kc/domain';

export interface IOrgTransparencyRepository {
  /** `slug` omitted = the platform organisation. Never throws for "not published": returns a hidden payload. */
  getPublic(slug?: string): Promise<OrgTransparency>;
}

export type TransparencySettingsPatch = Partial<Record<TransparencyToggle, boolean>>;

export interface ITransparencySettingsRepository {
  get(): Promise<TransparencySettings>;
  /** Merges `patch` into the stored settings and returns the full result. */
  set(patch: TransparencySettingsPatch): Promise<TransparencySettings>;
}
