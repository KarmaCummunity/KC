import { describe, it, expect } from 'vitest';
import type { NotificationPreferences } from '@kc/domain';
import type { NotificationPreferencesPatch } from '../../ports/IUserRepository';
import { UpdateNotificationPreferencesUseCase } from '../UpdateNotificationPreferencesUseCase';
import { applyNotificationPreferencesPatch } from '../applyNotificationPreferencesPatch';

/** Mirrors `users_merge_notification_preferences`: shallow merge, except `kinds` merges per key. */
class FakeUserRepo {
  prefs: NotificationPreferences = { critical: true, social: true };
  lastPatch: NotificationPreferencesPatch | null = null;

  async updateNotificationPreferences(
    _userId: string,
    partial: NotificationPreferencesPatch,
  ): Promise<NotificationPreferences> {
    this.lastPatch = partial;
    this.prefs = applyNotificationPreferencesPatch(this.prefs, partial);
    return this.prefs;
  }
}

describe('UpdateNotificationPreferencesUseCase', () => {
  it('updates only the supplied field', async () => {
    const repo = new FakeUserRepo();
    const uc = new UpdateNotificationPreferencesUseCase(repo);
    const result = await uc.execute({ userId: 'u1', critical: false });
    expect(result).toEqual({ critical: false, social: true });
  });

  it('updates both when both supplied', async () => {
    const repo = new FakeUserRepo();
    const uc = new UpdateNotificationPreferencesUseCase(repo);
    const result = await uc.execute({ userId: 'u1', critical: false, social: false });
    expect(result).toEqual({ critical: false, social: false });
  });

  it('forwards a per-kind opt-out without touching the category toggles', async () => {
    const repo = new FakeUserRepo();
    const uc = new UpdateNotificationPreferencesUseCase(repo);
    const result = await uc.execute({ userId: 'u1', kinds: { match_suggested: false } });
    expect(repo.lastPatch).toEqual({ kinds: { match_suggested: false } });
    expect(result).toEqual({ critical: true, social: true, kinds: { match_suggested: false } });
  });

  it('drops an empty kinds map instead of sending a no-op key', async () => {
    const repo = new FakeUserRepo();
    const uc = new UpdateNotificationPreferencesUseCase(repo);
    await uc.execute({ userId: 'u1', social: false, kinds: {} });
    expect(repo.lastPatch).toEqual({ social: false });
  });
});
