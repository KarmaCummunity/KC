import {
  FinanceLedgerError, isTransparencyToggle, type TransparencySettings,
} from '@kc/domain';
import type {
  ITransparencySettingsRepository, TransparencySettingsPatch,
} from './IOrgTransparencyRepository';

export class GetTransparencySettingsUseCase {
  constructor(private readonly repo: ITransparencySettingsRepository) {}

  execute(): Promise<TransparencySettings> {
    return this.repo.get();
  }
}

export class SetTransparencySettingsUseCase {
  constructor(private readonly repo: ITransparencySettingsRepository) {}

  /** Rejects empty patches and unknown keys before any network call. */
  execute(patch: TransparencySettingsPatch): Promise<TransparencySettings> {
    const keys = Object.keys(patch);
    if (keys.length === 0 || !keys.every(isTransparencyToggle)) {
      throw new FinanceLedgerError('invalid_settings', 'patch must contain known toggles only');
    }
    return this.repo.set(patch);
  }
}
