// useSurveyBanner — eligibility + snooze logic for the survey prompt banner.
// FR-SETTINGS-016 AC6: show at session N with 7-day snooze via AsyncStorage.
// KC#1058: the Sean Ellis PMF survey takes precedence when the user qualifies for it.
import { useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PMF_SURVEY_SLUG } from '@kc/domain';
import { container } from '../lib/container';
import { track } from '../lib/analytics';
import { recordActiveDayOncePerDay } from '../lib/activeDay';
import { useAuthStore } from '../store/authStore';

const SNOOZE_DAYS = 7;
const SESSION_COUNT_KEY = 'kc-app-session-count';
const UX_SURVEY_SLUG = 'ux-experience';
/** Checked in order; the banner offers the first eligible, non-snoozed survey. */
const SURVEY_SLUGS_BY_PRIORITY: readonly string[] = [PMF_SURVEY_SLUG, UX_SURVEY_SLUG];

function snoozeKey(slug: string): string {
  return `kc-survey-snooze-${slug}`;
}

function isSnoozed(snoozeAt: string | null): boolean {
  if (!snoozeAt) return false;
  const elapsedMs = Date.now() - new Date(snoozeAt).getTime();
  return elapsedMs < SNOOZE_DAYS * 24 * 60 * 60 * 1000;
}

export interface SurveyBannerState {
  readonly shouldShow: boolean;
  readonly slug: string;
  readonly onSnooze: () => Promise<void>;
}

/** First slug, in priority order, that is not snoozed and the server says to show. */
export async function findEligibleSlug(sessionCount: number): Promise<string | null> {
  for (const slug of SURVEY_SLUGS_BY_PRIORITY) {
    const snoozeAt = await AsyncStorage.getItem(snoozeKey(slug));
    if (isSnoozed(snoozeAt)) continue;
    const result = await container.checkSurveyPrompt.execute({ slug, sessionCount });
    if (result.show) return slug;
  }
  return null;
}

/**
 * Returns banner eligibility for the in-app surveys (PMF first, then ux-experience).
 * - Reads session count from AsyncStorage (incremented once per mount).
 * - Waits for today's active day so the PMF activity gate counts today.
 * - Suppresses a survey for 7 days after it is snoozed.
 * - Fails silently on network/storage errors.
 */
export function useSurveyBanner(): SurveyBannerState {
  const [slug, setSlug] = useState<string | null>(null);
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const checkedRef = useRef(false);

  useEffect(() => {
    if (checkedRef.current || !userId) return;
    checkedRef.current = true;

    void (async () => {
      try {
        // Increment and read session count.
        const raw = await AsyncStorage.getItem(SESSION_COUNT_KEY);
        const count = raw ? Number.parseInt(raw, 10) + 1 : 1;
        await AsyncStorage.setItem(SESSION_COUNT_KEY, String(count));

        // Shares the in-flight call started by useRecordActiveDay.
        await recordActiveDayOncePerDay(userId, () => container.recordActiveDay.execute());
        setSlug(await findEligibleSlug(count));
      } catch {
        // Fail silent — banner is non-critical.
      }
    })();
  }, [userId]);

  const onSnooze = useCallback(async (): Promise<void> => {
    if (!slug) return;
    setSlug(null);
    track('survey_prompt_snoozed', { slug });
    try {
      await AsyncStorage.setItem(snoozeKey(slug), new Date().toISOString());
    } catch {
      // Fail silent.
    }
  }, [slug]);

  return { shouldShow: slug !== null, slug: slug ?? UX_SURVEY_SLUG, onSnooze };
}
