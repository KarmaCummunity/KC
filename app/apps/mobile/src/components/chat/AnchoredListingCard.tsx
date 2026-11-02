// FR-CHAT-014 / KC#1297 — sticky anchored-listing card in chat (mirrors AnchoredRideCard).
// Shows the items/food/… listing the chat was opened from while the viewer can still see it:
// the detail RPC applies `is_listing_visible_to`, so a listing hidden from the viewer shows no card.
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { makeUseStyles, spacing } from '@kc/ui';
import { marketplaceRepository } from '../../services/marketplaceComposition';
import { listingImagePublicUrl } from '../../services/listingImageUpload';
import { KcRowCard } from '../cards/KcRowCard';
import { listingWorldIcon } from '../cards/ListingCard';
import { cleanDisplayTitle } from '../../lib/displayTitle';

interface Props {
  readonly anchorListingId: string;
}

export function AnchoredListingCard({ anchorListingId }: Props) {
  const { t, i18n } = useTranslation();
  const styles = useStyles();
  const router = useRouter();

  // Read the detail directly (not useMarketplaceListingDetail) so opening a chat does not
  // record a listing "view" signal.
  const query = useQuery({
    queryKey: ['chat-anchored-listing', anchorListingId],
    queryFn: () => marketplaceRepository().getListingDetail(anchorListingId),
  });

  const listing = query.data;
  if (!listing) return null;

  const isGive = listing.direction === 'give';
  const firstPhoto = [...listing.media].sort((a, b) => a.sortOrder - b.sortOrder)[0];
  const kindLabel = i18n.language.startsWith('he') ? listing.kindLabelHe : listing.kindLabelEn;

  return (
    <KcRowCard
      testID="chat-anchored-listing"
      containerStyle={styles.banner}
      onPress={() => router.push(`/listing/${listing.listingId}`)}
      accessibilityLabel={t('chat.anchoredOpenA11y')}
      tone={isGive ? 'give' : 'request'}
      badgeLabel={t(isGive ? 'feed.giveTypeShort' : 'feed.requestTypeShort')}
      placeholderIcon={listingWorldIcon(listing.worldSlug)}
      imageUri={firstPhoto ? listingImagePublicUrl(firstPhoto.storagePath) : null}
      title={cleanDisplayTitle(listing.title)}
      meta={[`${t(`marketplace.world.${listing.worldSlug}`, { defaultValue: listing.worldSlug })} · ${kindLabel}`]}
      openLinkLabel={t('cards.openFullPost')}
    />
  );
}

const useStyles = makeUseStyles(() => ({
  banner: { marginHorizontal: spacing.base, marginTop: spacing.sm },
}));
