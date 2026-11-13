// Media area of a listing page, sized like the post page's `PostImageCarousel` so both heroes look
// the same: paged photos, or a placeholder icon when the listing has none.
import React, { useState } from 'react';
import { ScrollView, View, type LayoutChangeEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { makeUseStyles, useTheme } from '@kc/ui';
import type { MarketplaceListingMedia } from '@kc/domain';
import { KCImage } from '../ui/KCImage';
import { listingImagePublicUrl } from '../../services/listingImageUpload';
import { getSupabaseHeroImageUrl } from '../../lib/imageUrl';

/** Bucket of listing photos (a listing is a post, so its photos live with the post photos). */
const LISTING_BUCKET = 'post-images';

/** Same height as the post carousel frame. */
const HEIGHT = 240;
const PLACEHOLDER_ICON_SIZE = 72;

type Props = Readonly<{
  media: readonly MarketplaceListingMedia[];
  fallbackIcon: React.ComponentProps<typeof Ionicons>['name'];
}>;

const useStyles = makeUseStyles(({ colors }) => ({
  frame: { height: HEIGHT, backgroundColor: colors.skeleton, overflow: 'hidden' },
  empty: { justifyContent: 'center' as const, alignItems: 'center' as const },
}));

export function ListingMediaGallery({ media, fallbackIcon }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  // `pagingEnabled` only snaps per photo when each page is exactly as wide as the frame.
  const [width, setWidth] = useState(0);

  if (media.length === 0) {
    return (
      <View style={[styles.frame, styles.empty]}>
        <Ionicons name={fallbackIcon} size={PLACEHOLDER_ICON_SIZE} color={colors.textSecondary} />
      </View>
    );
  }

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <View style={styles.frame} onLayout={onLayout}>
      {width > 0 ? (
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
          {media.map((item) => (
            <KCImage
              key={item.storagePath}
              uri={getSupabaseHeroImageUrl(LISTING_BUCKET, item.storagePath, width)}
              fallbackUri={listingImagePublicUrl(item.storagePath)}
              style={{ width, height: HEIGHT }}
              contentFit="cover"
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}
