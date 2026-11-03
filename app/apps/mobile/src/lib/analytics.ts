// Product analytics facade — PostHog when EXPO_PUBLIC_POSTHOG_KEY is set, else no-op
// (console in __DEV__). PII-free properties only (slugs, enums, counts — never email/phone).
// Survey events: FR-SETTINGS-016 AC6. Funnel events: KC#946.

import { capturePosthog } from './observability/posthog';

export type SurveyAnalyticsEvent =
  | 'survey_opened'
  | 'survey_question_answered'
  | 'survey_completed'
  | 'survey_prompt_snoozed'
  | 'feedback_submitted'
  | 'research_share_initiated';

/** Key product funnels (#946) + core loop (#1055). */
export type FunnelAnalyticsEvent =
  | 'signup'
  | 'activation'
  | 'listing_created'
  | 'match_shown'
  | 'match_feedback'
  | 'match_made'
  | 'chat_started'
  | 'handover_completed'
  | 'return_visit'
  | 'donation';

export type AnalyticsEvent = SurveyAnalyticsEvent | FunnelAnalyticsEvent;

type EventProperties = Record<string, unknown>;

/**
 * Emit a product analytics event.
 * Forwards to PostHog when initialised; otherwise __DEV__ console only.
 */
export function track(event: AnalyticsEvent, properties?: EventProperties): void {
  if (__DEV__) {
    console.log('[analytics]', event, properties ?? {});
  }
  capturePosthog(event, properties);
}
