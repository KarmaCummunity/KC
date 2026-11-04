// Hero frame shared by the post page and the listing page: a rounded media area with an optional
// status badge (top inline-start corner) and an optional give/request tag (bottom inline-end corner).
import React from 'react';
import { View } from 'react-native';
import { Text } from '@kc/ui';
import { usePostDetailStyles } from '../../screens/post/postDetailScreen.styles';

type Props = Readonly<{
  /** Media content: carousel, gallery or the placeholder icon. */
  children: React.ReactNode;
  /** Localized label of the give/request tag; the tag is hidden when omitted. */
  typeLabel?: string;
  /** Give tags use the accent color; request tags stay white on the dark pill. */
  isGive?: boolean;
  /** Pill pinned to the top corner, e.g. the post status. */
  badge?: React.ReactNode;
  /** Closed posts get a green outline and a tint over the lower part of the hero. */
  closed?: boolean;
}>;

export function DetailHeroCard({ children, typeLabel, isGive = true, badge, closed = false }: Props) {
  const styles = usePostDetailStyles();
  return (
    <View style={[styles.imageWrap, closed ? styles.imageWrapClosed : null]}>
      {children}
      {closed ? <View style={styles.closedImageTint} pointerEvents="none" /> : null}
      {badge ? <View style={styles.statusBadgePos}>{badge}</View> : null}
      {typeLabel ? (
        <View style={styles.typeTagOverlay}>
          <Text style={isGive ? styles.giveTagText : styles.requestTagText}>{typeLabel}</Text>
        </View>
      ) : null}
    </View>
  );
}
