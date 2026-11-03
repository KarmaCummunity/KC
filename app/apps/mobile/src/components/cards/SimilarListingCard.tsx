// Compact listing tile (similar-listings carousel, profile listings) — the shared base
// post card (KcCard) in its compact size, with give/request tone and closed status.
import React from 'react';
import { useTranslation } from 'react-i18next';
import { cleanDisplayTitle } from '../../lib/displayTitle';
import { KcCard } from './KcCard';
import { listingWorldIcon } from './ListingCard';

export const SIMILAR_TILE_WIDTH = 160;

export interface CompactListingItem {
  readonly listingId: string;
  readonly title: string;
  readonly worldSlug: string;
  readonly kindSlug?: string | null;
  readonly direction?: 'give' | 'request';
  readonly status?: string;
}

interface Props {
  readonly item: CompactListingItem;
  readonly onPress: () => void;
  readonly width?: number;
}

export function compactListingIsRequest(item: CompactListingItem): boolean {
  if (item.direction) return item.direction === 'request';
  return /request|seek|need/i.test(item.kindSlug ?? '');
}

function SimilarListingCardInner({ item, onPress, width = SIMILAR_TILE_WIDTH }: Props) {
  const { t } = useTranslation();
  const isRequest = compactListingIsRequest(item);
  const title = cleanDisplayTitle(item.title);
  return (
    <KcCard
      testID={`similar-card-${item.listingId}`}
      width={width}
      dense
      onPress={onPress}
      accessibilityLabel={title}
      placeholderIcon={listingWorldIcon(item.worldSlug)}
      tone={isRequest ? 'request' : 'give'}
      badgeLabel={t(isRequest ? 'feed.requestTypeShort' : 'feed.giveTypeShort')}
      title={title}
      chip={t(`marketplace.world.${item.worldSlug}`, { defaultValue: item.worldSlug })}
      closed={item.status === 'closed'}
      closedLabel={t('cards.closed')}
    />
  );
}

export const SimilarListingCard = React.memo(SimilarListingCardInner);
