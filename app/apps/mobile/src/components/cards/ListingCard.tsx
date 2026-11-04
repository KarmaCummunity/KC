// Marketplace listing (items, food, rides, knowledge, ...) rendered with the shared KcCard.
// It reads like the feed card of the same post (docs/spec/07 §7.4, #1412): the same direction
// badge, the world chip, and the publisher's name and avatar; a ride adds its route and seats.
import React from 'react';
import type { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { he as dateFnsHe } from 'date-fns/locale';
import type { MarketplaceBrowseRow } from '@kc/domain';
import { cleanDisplayTitle } from '../../lib/displayTitle';
import { worldChipKey } from '../../lib/feedCardCategory';
import { usePostGridCardWidth } from '../../hooks/useShellContentWidth';
import { KcCard } from './KcCard';
import { listingCardDetails, listingCardRoute, type ListingCardDetail } from './listingCardContent';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const WORLD_ICON: Record<string, IconName> = {
  rides: 'car-outline',
  food: 'restaurant-outline',
  items: 'gift-outline',
  housing: 'home-outline',
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
  /** Extra lines after the card's own details (e.g. a ride's pickup points or recurrence). */
  extraDetails?: readonly ListingCardDetail[];
}

const TILE_WIDTH = 200;

function ListingCardInner({ item, onPress, variant = 'grid', meta, extraDetails }: Readonly<Props>) {
  const { t } = useTranslation();
  const gridWidth = usePostGridCardWidth(2);
  const isRequest = item.direction === 'request';
  const isRide = item.worldSlug === 'rides';
  const title = cleanDisplayTitle(item.title);
  const ride = isRide ? item.ride ?? null : null;
  const details = [
    ...listingCardDetails({
      ride,
      isRequest,
      secondary: meta === undefined ? item.summary : meta,
      t,
      formatTime: formatRideTime,
    }),
    ...(extraDetails ?? []),
  ];
  const route = listingCardRoute(ride, t);
  const author = item.publisher
    ? { name: item.publisher.displayName ?? t('marketplace.anonymousOwner'), avatarUrl: item.publisher.avatarUrl }
    : null;
  const distance = item.distanceKm != null ? t('matches.distanceKm', { km: item.distanceKm.toFixed(1) }) : null;

  return (
    <KcCard
      width={variant === 'tile' ? TILE_WIDTH : gridWidth}
      onPress={onPress}
      accessibilityLabel={title}
      placeholderIcon={listingWorldIcon(item.worldSlug)}
      tone={isRequest ? 'request' : 'give'}
      badgeLabel={t(isRequest ? 'feed.requestTypeShort' : 'feed.giveTypeShort')}
      author={author}
      title={title}
      chip={t(worldChipKey(item.worldSlug), { defaultValue: item.worldSlug })}
      route={route}
      details={details}
      location={distance}
    />
  );
}

export const ListingCard = React.memo(ListingCardInner);
