// Content rules of a marketplace listing card (FR-POST-014 card, docs/spec/07 §7.4): the
// detail lines (a ride's departure and seats, else the listing's secondary line) and a ride's
// route. Pure, so the card component stays composition only.
import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';
import type { RideCardSummary } from '@kc/domain';
import { cleanDisplayTitle } from '../../lib/displayTitle';
import { rideSeatCountKey } from '../../lib/rideSeatCountKey';

type IconName = ComponentProps<typeof Ionicons>['name'];
type Translate = (key: string, options?: Record<string, unknown>) => string;
/** Formats a departure for the card; null when it cannot (missing or invalid). */
type FormatTime = (iso: string | null | undefined) => string | null;

export interface ListingCardDetail {
  readonly icon: IconName;
  readonly text: string;
}

export interface ListingCardRoute {
  readonly from: string;
  readonly to: string;
}

/** A ride's departure and seats (offer) or passengers (request), when known. */
function rideDetails(
  ride: RideCardSummary,
  isRequest: boolean,
  t: Translate,
  formatTime: FormatTime,
): ListingCardDetail[] {
  const details: ListingCardDetail[] = [];
  const when = formatTime(ride.departsAt);
  if (when) details.push({ icon: 'time-outline', text: when });
  if (ride.seats != null) {
    details.push({
      icon: 'people-outline',
      text: t(rideSeatCountKey(isRequest ? 'passengers' : 'seats', ride.seats), { count: ride.seats }),
    });
  }
  return details;
}

/**
 * Detail lines of the card: a ride's own lines first; when there are none, the secondary line
 * (the caller's meta, else the listing summary), if any.
 */
export function listingCardDetails(args: {
  readonly ride: RideCardSummary | null;
  readonly isRequest: boolean;
  readonly secondary: string | null | undefined;
  readonly t: Translate;
  readonly formatTime: FormatTime;
}): ListingCardDetail[] {
  const details = args.ride ? rideDetails(args.ride, args.isRequest, args.t, args.formatTime) : [];
  if (details.length === 0 && args.secondary) {
    details.push({ icon: 'information-circle-outline', text: cleanDisplayTitle(args.secondary) });
  }
  return details;
}

/** A ride's "from → to" when either end is known; the unknown end reads "unknown place". */
export function listingCardRoute(ride: RideCardSummary | null, t: Translate): ListingCardRoute | null {
  if (!ride || (!ride.originLabel && !ride.destLabel)) return null;
  return {
    from: ride.originLabel ?? t('cards.unknownPlace'),
    to: ride.destLabel ?? t('cards.unknownPlace'),
  };
}
