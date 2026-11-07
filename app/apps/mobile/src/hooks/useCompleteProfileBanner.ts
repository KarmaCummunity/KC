// FR-VERIFY-013 AC2–AC4 — main-feed "complete your profile" banner with a 7-day snooze
// stored on the device per user. Shown only while the own profile is below level 1.
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from '../store/authStore';
import { useOwnProfileIncomplete } from './useOwnProfileIncomplete';

export const COMPLETE_PROFILE_SNOOZE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export function completeProfileSnoozeKey(userId: string): string {
  return `kc-complete-profile-snooze-${userId}`;
}

/** True while a snooze stamp is younger than 7 days. Missing or unparsable stamp = not snoozed. */
export function isCompleteProfileSnoozed(snoozedAt: string | null, nowMs: number): boolean {
  if (!snoozedAt) return false;
  const at = Date.parse(snoozedAt);
  if (Number.isNaN(at)) return false;
  return nowMs - at < COMPLETE_PROFILE_SNOOZE_DAYS * DAY_MS;
}

export interface CompleteProfileBannerState {
  readonly shouldShow: boolean;
  readonly onDismiss: () => void;
}

export function useCompleteProfileBanner(): CompleteProfileBannerState {
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const incomplete = useOwnProfileIncomplete();
  const [snoozed, setSnoozed] = useState(true);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    AsyncStorage.getItem(completeProfileSnoozeKey(userId))
      .then((at) => {
        if (!cancelled) setSnoozed(isCompleteProfileSnoozed(at, Date.now()));
      })
      .catch(() => {
        if (!cancelled) setSnoozed(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const onDismiss = useCallback(() => {
    setSnoozed(true);
    if (!userId) return;
    AsyncStorage.setItem(completeProfileSnoozeKey(userId), new Date().toISOString()).catch(() => {});
  }, [userId]);

  return { shouldShow: Boolean(userId) && incomplete && !snoozed, onDismiss };
}
