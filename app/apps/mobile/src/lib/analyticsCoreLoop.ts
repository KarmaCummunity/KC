// Core product loop events (#1055) — city + world on every emit.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { analyticsCitySegment } from '@kc/domain';
import { track, type AnalyticsEvent } from './analytics';

const ACTIVATION_KEY = 'kc_core_loop_activation_sent';
const RETURN_VISIT_KEY = 'kc_core_loop_return_visit_sent';

export type CoreLoopEvent =
  | 'signup'
  | 'activation'
  | 'listing_created'
  | 'match_shown'
  | 'match_feedback'
  | 'chat_started'
  | 'handover_completed'
  | 'return_visit';

type CoreLoopProps = {
  readonly world?: string;
  readonly cityId?: string | null;
  readonly [key: string]: unknown;
};

function withCoreLoopProps(props?: CoreLoopProps): Record<string, unknown> {
  const cityId = props?.cityId ?? null;
  const { cityId: _drop, ...rest } = props ?? {};
  return {
    ...rest,
    city: analyticsCitySegment(cityId),
    ...(props?.world ? { world: props.world } : {}),
  };
}

export function trackCoreLoop(event: CoreLoopEvent, props?: CoreLoopProps): void {
  track(event as AnalyticsEvent, withCoreLoopProps(props));
}

/**
 * Whole seconds from account creation to `now` (#1042 time-to-first-post). Null when the
 * creation time is unknown, unparsable or ahead of the device clock (skew), so a bad value
 * never pollutes the median.
 */
export function secondsSinceSignup(accountCreatedAt: string | null | undefined, now = Date.now()): number | null {
  if (!accountCreatedAt) return null;
  const created = Date.parse(accountCreatedAt);
  if (Number.isNaN(created) || created > now) return null;
  return Math.floor((now - created) / 1000);
}

type ActivationProps = CoreLoopProps & {
  /** Auth account creation time (ISO); sent only as `seconds_since_signup`. */
  readonly accountCreatedAt?: string | null;
};

/** First listing or post in the session path counts as activation once per install. */
export async function trackActivationIfFirst(props: ActivationProps): Promise<void> {
  const { accountCreatedAt, ...rest } = props;
  const seconds = secondsSinceSignup(accountCreatedAt);
  const activation: CoreLoopProps = seconds === null ? rest : { ...rest, seconds_since_signup: seconds };
  try {
    const sent = await AsyncStorage.getItem(ACTIVATION_KEY);
    if (sent === '1') return;
    await AsyncStorage.setItem(ACTIVATION_KEY, '1');
    trackCoreLoop('activation', activation);
  } catch {
    trackCoreLoop('activation', activation);
  }
}

/** Logged-in reopen after the first app open on this install. */
export async function trackReturnVisitIfReturning(props: CoreLoopProps): Promise<void> {
  try {
    const seen = await AsyncStorage.getItem(RETURN_VISIT_KEY);
    if (seen === '1') {
      trackCoreLoop('return_visit', props);
      return;
    }
    await AsyncStorage.setItem(RETURN_VISIT_KEY, '1');
  } catch {
    /* no-op */
  }
}
