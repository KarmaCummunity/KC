// Marketplace listing (items, food, rides, knowledge, ...) rendered with the shared KcCard.
import React from 'react';
import type { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { he as dateFnsHe } from 'date-fns/locale';
import type { MarketplaceBrowseRow } from '@kc/domain';
import { cleanDisplayTitle } from '../../lib/displayTitle';
import { usePostGridCardWidth } from '../../hooks/useShellContentWidth';
import { KcCard } from './KcCard';
import { rideSeatCountKey } from '../../lib/rideSeatCountKey';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const WORLD_ICON: Record<string, IconName> = {
  rides: 'car-outline',
  food: 'restaurant-outline',
  items: 'gift-outline',
  knowledge: 'school-outline',
  time: 'time-outline',
  money: 'cash-outline',
};

export function listingWorldIcon(worldSlug: string): IconName {
  return WORLD_ICON[worldSlug] ?? 'pricetag-outline';
}

export function formatRideTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return format(d, 'EEEE d/M · HH:mm', { locale: dateFnsHe });
}

interface Props {
  item: MarketplaceBrowseRow;
  onPress: () => void;
  /** 'grid' = 2-column grid cell width; 'tile' = fixed width for carousels. */
  variant?: 'grid' | 'tile';
  /** Optional secondary line (defaults to summary). */
  meta?: string | null;
}

const TILE_WIDTH = 200;

function listingBadgeLabel(t: (k: string) => string, isRide: boolean, isRequest: boolean): string {
  if (isRide) return t(isRequest ? 'cards.rideRequest' : 'cards.rideOffer');
  return t(isRequest ? 'feed.requestTypeShort' : 'feed.giveTypeShort');
}

type CardDetail = { icon: IconName; text: string };
type Translate = (key: string, options?: Record<string, unknown>) => string;
type RideSummary = NonNullable<Props['item']['ride']>;

/** A ride's departure time and seat (offer) or passenger (request) count. */
function rideDetails(t: Translate, ride: RideSummary, isRequest: boolean): CardDetail[] {
  const details: CardDetail[] = [];
  const when = formatRideTime(ride.departsAt);
  if (when) details.push({ icon: 'time-outline', text: when });
  if (ride.seats != null) {
    const key = rideSeatCountKey(isRequest ? 'passengers' : 'seats', ride.seats);
    details.push({ icon: 'people-outline', text: t(key, { count: ride.seats }) });
  }
  return details;
}

/** The ride's origin → destination line, or null when neither end is known. */
function rideRoute(t: Translate, ride: RideSummary | null): { from: string; to: string } | null {
  if (!ride || (!ride.originLabel && !ride.destLabel)) return null;
  return { from: ride.originLabel ?? t('cards.unknownPlace'), to: ride.destLabel ?? t('cards.unknownPlace') };
}

function ListingCardInner({ item, onPress, variant = 'grid', meta }: Readonly<Props>) {
  const { t } = useTranslation();
  const gridWidth = usePostGridCardWidth(2);
  const isRequest = item.direction === 'request';
  const isRide = item.worldSlug === 'rides';
  const title = cleanDisplayTitle(item.title);
  const ride = isRide ? item.ride ?? null : null;

  const details = ride ? rideDetails(t, ride, isRequest) : [];
  const route = rideRoute(t, ride);
  const secondary = meta === undefined ? item.summary : meta;
  if (details.length === 0 && secondary) details.push({ icon: 'information-circle-outline', text: cleanDisplayTitle(secondary) });
  const badgeLabel = listingBadgeLabel(t, isRide, isRequest);
  const distance = item.distanceKm != null ? t('matches.distanceKm', { km: item.distanceKm.toFixed(1) }) : null;

  return (
    <KcCard
      width={variant === 'tile' ? TILE_WIDTH : gridWidth}
      onPress={onPress}
      accessibilityLabel={title}
      placeholderIcon={listingWorldIcon(item.worldSlug)}
      tone={isRequest ? 'request' : 'give'}
      badgeLabel={badgeLabel}
      title={title}
      chip={isRide ? null : t(`marketplace.world.${item.worldSlug}`, { defaultValue: item.worldSlug })}
      route={route}
      details={details}
      location={distance}
    />
  );
}

export const ListingCard = React.memo(ListingCardInner);
