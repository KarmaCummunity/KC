// #2277 (docs/spec/requirements/12_super_admin.md, FR-ADMIN-034): the super admin switches a giving
// world between portal and active from the admin portal. The world's launch flag is the switch;
// each database keeps its own, so the same screen switches kc-dev in the dev app and production in
// the production app. The server re-checks the role; this use case refuses any other flag.
import { isAdminSwitchableWorldFlag, ValidationError, type WorldLaunchMode } from '@kc/domain';
import type { IAppFlagsAdminRepository } from '../ports/IAppFlagsAdminRepository';

export interface SetWorldLaunchModeInput {
  /** The world's launch flag, `world_<slug>_enabled`. */
  readonly flagKey: string;
  readonly mode: WorldLaunchMode;
}

export class SetWorldLaunchModeUseCase {
  constructor(private readonly flags: IAppFlagsAdminRepository) {}

  async execute(input: SetWorldLaunchModeInput): Promise<void> {
    if (!isAdminSwitchableWorldFlag(input.flagKey)) {
      throw new ValidationError(`not a switchable world flag: ${input.flagKey}`, 'flagKey');
    }
    await this.flags.setFlag(input.flagKey, input.mode === 'active');
  }
}
