// Single shared card for every post / listing type (items, rides, food, knowledge,
// requests & offers). Layout: image-or-icon area with type badge + menu overlay,
// author row, title (+ chip), optional route/details lines, location · time footer.
import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, iconSize, Text } from '@kc/ui';
import { MirroredIcon } from '../ui/MirroredIcon';
import type { VerificationLevel } from '@kc/domain';
import { AvatarInitials } from '../AvatarInitials';
import { VerificationBadge } from '../VerificationBadge';
import { KCImage } from '../ui/KCImage';
import { usePostCardGridStyles } from '../PostCardGrid.styles';
import { useKcCardExtraStyles } from './KcCard.styles';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export interface KcCardProps {
  width: number;
  dense?: boolean;
  onPress: () => void;
  /** Fires on touch-down, before navigation, so a photo can start downloading. */
  onPressIn?: () => void;
  accessibilityLabel?: string;
  imageUri?: string | null;
  fallbackUri?: string | null;
  onImageLoad?: () => void;
  placeholderIcon: IoniconName;
  tone: 'give' | 'request';
  badgeLabel: string;
  roleBadgeLabel?: string | null;
  menu?: React.ReactNode;
  author?: { name: string; avatarUrl?: string | null; verificationLevel?: VerificationLevel } | null;
  /** Overrides `author` — e.g. tappable owner + counterparty row that must not trigger card press. */
  authorsRow?: React.ReactNode;
  /** Plain title, or a custom node (e.g. translatable text). */
  title: React.ReactNode;
  chip?: string | null;
  route?: { from: string; to: string } | null;
  details?: ReadonlyArray<{ icon: IoniconName; text: string }>;
  location?: string | null;
  timeAgo?: string | null;
  /** Height of the image area relative to width (default 0.72; wide rows use less). */
  imageRatio?: number;
  /** Extra status chip under the image (e.g. match % / "waiting for other side"). */
  statusLabel?: string | null;
  /** Closed / delivered post — dims the card and shows the closed chip. */
  closed?: boolean;
  closedLabel?: string;
  /** Slot rendered below the footer (e.g. accept / decline actions). */
  footer?: React.ReactNode;
  testID?: string;
}

const OWNER_AVATAR_SIZE = 24;

function KcCardInner(p: Readonly<KcCardProps>) {
  const { colors } = useTheme();
  const styles = usePostCardGridStyles();
  const extra = useKcCardExtraStyles();
  const isGive = p.tone === 'give';
  const placeholderBg = isGive ? colors.primarySurface : `${colors.secondary}18`;

  return (
    <TouchableOpacity
      testID={p.testID ?? 'kc-post-card'}
      style={[styles.card, { width: p.width }, p.closed && extra.closed]}
      activeOpacity={0.86}
      onPress={p.onPress}
      onPressIn={p.onPressIn}
      accessibilityRole="button"
      accessibilityLabel={p.accessibilityLabel}
    >
      <View style={[styles.imageArea, { height: p.width * (p.imageRatio ?? 0.72), backgroundColor: placeholderBg }]}>
        {p.imageUri ? (
          <KCImage uri={p.imageUri} fallbackUri={p.fallbackUri ?? undefined} style={styles.image} contentFit="cover" onLoad={p.onImageLoad} />
        ) : (
          <View style={styles.placeholderTint}>
            <Ionicons name={p.placeholderIcon} size={p.dense ? 28 : 40} color={isGive ? colors.giveTag : colors.secondary} />{/* brand-guard-allow: illustration glyph remains larger than the row icon scale */}
          </View>
        )}
        <View style={[styles.typePill, p.dense && styles.typePillDense]}>
          <Text style={[styles.typePillText, isGive ? styles.givePillText : styles.requestPillText, p.dense && styles.typePillTextDense]}>
            {p.badgeLabel}
          </Text>
        </View>
        {p.roleBadgeLabel ? (
          <View style={[styles.roleBadge, p.dense && styles.roleBadgeDense]}>
            <Text style={[styles.roleBadgeText, p.dense && styles.roleBadgeTextDense]}>{p.roleBadgeLabel}</Text>
          </View>
        ) : null}
        {p.menu ? (
          <View
            style={[styles.menuOverlay, p.dense && styles.menuOverlayDense]}
            onStartShouldSetResponder={() => true}
            onResponderRelease={(e) => e.stopPropagation()}
          >
            {p.menu}
          </View>
        ) : null}
      </View>

      <View style={styles.content}>
        {p.statusLabel || p.closed ? (
          <View style={extra.statusRow}>
            {p.closed ? (
              <View style={[extra.statusChip, extra.closedChip]} testID="kc-card-closed">
                <Text style={extra.closedChipText}>{p.closedLabel ?? ''}</Text>
              </View>
            ) : null}
            {p.statusLabel ? (
              <View style={extra.statusChip} testID="kc-card-status">
                <Text style={extra.statusChipText} numberOfLines={1}>{p.statusLabel}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
        {p.authorsRow && !p.dense ? p.authorsRow : null}
        {!p.authorsRow && p.author && !p.dense ? (
          <View style={styles.authorRow} accessibilityLabel={p.author.name}>
            <AvatarInitials name={p.author.name} avatarUrl={p.author.avatarUrl ?? null} size={OWNER_AVATAR_SIZE} />
            <Text style={styles.ownerName} numberOfLines={1}>{p.author.name}</Text>
            <VerificationBadge level={p.author.verificationLevel} />
          </View>
        ) : null}

        <View style={styles.titleRow}>
          <View style={styles.titleCol}>
            {typeof p.title === 'string' ? (
              <Text style={[styles.title, p.dense && styles.titleDense]} numberOfLines={2}>{p.title}</Text>
            ) : p.title}
          </View>
          {p.chip ? (
            <View style={[styles.categoryChip, p.dense && styles.categoryChipDense]}>
              <Text style={[styles.categoryChipText, p.dense && styles.categoryChipTextDense]} numberOfLines={1}>{p.chip}</Text>
            </View>
          ) : null}
        </View>

        {p.route ? (
          <View style={extra.routeRow}>
            <Text style={extra.routeText} numberOfLines={1}>{p.route.from}</Text>
            <MirroredIcon name="arrow-forward" size={iconSize.xs} color={colors.primary} />
            <Text style={extra.routeText} numberOfLines={1}>{p.route.to}</Text>
          </View>
        ) : null}

        {p.details && p.details.length > 0 ? (
          <View style={extra.detailsRow}>
            {p.details.map((d) => (
              <View key={d.text} style={extra.detail}>
                <Ionicons name={d.icon} size={iconSize.xs} color={colors.textSecondary} />
                <Text style={extra.detailText} numberOfLines={1}>{d.text}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {p.location || p.timeAgo ? (
          <View style={styles.metaFooter}>
            <View style={styles.locationRow}>
              {p.location ? <Ionicons name="location-outline" size={iconSize.xs} color={colors.textSecondary} /> : null}
              <Text style={styles.locationText} numberOfLines={1}>{p.location ?? ''}</Text>
            </View>
            {p.timeAgo ? <Text style={styles.timeAgo} numberOfLines={1}>{p.timeAgo}</Text> : null}
          </View>
        ) : null}
        {p.footer ? <View style={extra.footer}>{p.footer}</View> : null}
      </View>
    </TouchableOpacity>
  );
}

export const KcCard = React.memo(KcCardInner);
