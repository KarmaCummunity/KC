// UpdateNotificationPreferencesUseCase — P1.5
// Mapped to: FR-NOTIF-014, FR-NOTIF-017, FR-SETTINGS-005.
// Atomically merges notification preference toggles; unmentioned keys are preserved.
// `kinds` is merged per key server-side, so a single kind can be toggled on its own.

import type { IUserRepository, NotificationPreferencesPatch } from '../ports/IUserRepository';
import type { NotificationPreferences } from '@kc/domain';

export class UpdateNotificationPreferencesUseCase {
  constructor(
    private readonly userRepo: Pick<IUserRepository, 'updateNotificationPreferences'>,
  ) {}

  execute(input: { userId: string } & NotificationPreferencesPatch): Promise<NotificationPreferences> {
    const partial: NotificationPreferencesPatch = {};
    if (input.critical !== undefined) partial.critical = input.critical;
    if (input.social !== undefined) partial.social = input.social;
    if (input.quietHours !== undefined) partial.quietHours = input.quietHours;
    if (input.kinds !== undefined && Object.keys(input.kinds).length > 0) partial.kinds = input.kinds;
    return this.userRepo.updateNotificationPreferences(input.userId, partial);
  }
}
