// Compact row variant of the shared base post card (KcCard design language):
// thumbnail-or-type-icon square, type pill, title, meta lines, status / closed chips,
// optional trailing + footer action slots, and an optional "open full post" link.
// Used for list rows (shifts, my-listings, handoffs, ride search) and chat previews —
// it never renders a post body, only a short preview.
import React from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MirroredIcon } from '../ui/MirroredIcon';
import { useTheme, Text, iconSize } from '@kc/ui';
import { KCImage } from '../ui/KCImage';
import { useKcRowCardStyles } from './KcRowCard.styles';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export interface KcRowCardProps {
  readonly title: string;
  readonly tone: 'give' | 'request';
  readonly badgeLabel?: string | null;
  readonly placeholderIcon: IoniconName;
  readonly imageUri?: string | null;
  readonly fallbackUri?: string | null;
  readonly meta?: ReadonlyArray<string | null | undefined>;
  readonly statusLabel?: string | null;
  readonly closed?: boolean;
  readonly closedLabel?: string;
  readonly onPress?: () => void;
  readonly accessibilityLabel?: string;
  /** Shows a "open full post" link row (chat previews). */
  readonly openLinkLabel?: string | null;
  readonly trailing?: React.ReactNode;
  readonly footer?: React.ReactNode;
  readonly testID?: string;
  readonly containerStyle?: StyleProp<ViewStyle>;
}

const THUMB = 52;

function KcRowCardInner(p: KcRowCardProps) {
  const { colors } = useTheme();
  const s = useKcRowCardStyles();
  const isGive = p.tone === 'give';
  const meta = (p.meta ?? []).filter((m): m is string => Boolean(m));
  return (
    <Pressable
      testID={p.testID ?? 'kc-row-card'}
      onPress={p.onPress}
      disabled={!p.onPress}
      accessibilityRole={p.onPress ? 'button' : undefined}
      accessibilityLabel={p.accessibilityLabel ?? p.title}
      style={[s.card, p.closed && s.closed, p.containerStyle]}
    >
      <View style={s.main}>
        <View style={[s.thumb, { width: THUMB, height: THUMB }, isGive ? s.thumbGive : s.thumbRequest]}>
          {p.imageUri ? (
            <KCImage uri={p.imageUri} fallbackUri={p.fallbackUri ?? undefined} style={s.image} contentFit="cover" />
          ) : (
            <Ionicons name={p.placeholderIcon} size={iconSize.xl} color={isGive ? colors.giveTag : colors.secondary} />
          )}
        </View>
        <View style={s.body}>
          <View style={s.chips}>
            {p.badgeLabel ? (
              <View style={[s.pill, isGive ? s.givePill : s.requestPill]}>
                <Text style={[s.pillText, isGive ? s.givePillText : s.requestPillText]}>{p.badgeLabel}</Text>
              </View>
            ) : null}
            {p.closed ? (
              <View style={[s.pill, s.mutedPill]} testID="kc-row-closed">
                <Text style={[s.pillText, s.mutedPillText]}>{p.closedLabel ?? ''}</Text>
              </View>
            ) : null}
            {p.statusLabel ? (
              <View style={[s.pill, s.statusPill]} testID="kc-row-status">
                <Text style={[s.pillText, s.statusPillText]} numberOfLines={1}>{p.statusLabel}</Text>
              </View>
            ) : null}
          </View>
          <Text style={s.title} numberOfLines={1}>{p.title}</Text>
          {meta.map((m) => (
            <Text key={m} style={s.meta} numberOfLines={1}>{m}</Text>
          ))}
          {p.openLinkLabel ? (
            <View style={s.openLink} testID="kc-row-open-link" accessibilityRole="link">
              <Text style={s.openLinkText}>{p.openLinkLabel}</Text>
              <MirroredIcon name="chevron-forward" size={iconSize.xs} color={colors.primary} />
            </View>
          ) : null}
        </View>
        {p.trailing ? <View style={s.trailing}>{p.trailing}</View> : null}
      </View>
      {p.footer ? <View style={s.footer}>{p.footer}</View> : null}
    </Pressable>
  );
}

export const KcRowCard = React.memo(KcRowCardInner);
