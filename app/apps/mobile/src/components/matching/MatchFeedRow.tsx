// Compact match row for feed / hub sections (matching v2).
import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import type { MatchSuggestion } from '@kc/infrastructure-supabase';
import { iconSize, makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { AvatarInitials } from '../AvatarInitials';
import { rowDirectionStart } from '../../lib/rtlLayout';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { cleanDisplayTitle } from '../../lib/displayTitle';
import { matchStateOf, scorePercent } from '../../lib/matching';

type Props = {
  readonly match: MatchSuggestion;
  readonly busy?: boolean;
  readonly onRespond: (candidateId: string, response: 'accept' | 'decline') => void;
};

export function MatchFeedRow({ match, busy, onRespond }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const state = matchStateOf(match);
  const owner = match.otherOwner.displayName ?? t('matches.someone');
  const title = cleanDisplayTitle(match.otherListingTitle);
  const canRespond = state === 'new' || state === 'theyAccepted';
  const openListing = () =>
    router.push({ pathname: '/listing/[listingId]', params: { listingId: match.otherListingId } });

  return (
    <Card padding="sm" style={styles.card} testID={`match-feed-row-${match.candidateId}`}>
      <TouchableOpacity onPress={openListing} activeOpacity={0.85} accessibilityRole="button">
        <View style={styles.topRow}>
          <AvatarInitials name={owner} avatarUrl={match.otherOwner.avatarUrl} size={44} />
          <View style={styles.textCol}>
            <Text style={styles.title} numberOfLines={2}>{title}</Text>
            <Text style={styles.meta} numberOfLines={1}>
              {t(match.myRole === 'offer' ? 'matches.forYourOffer' : 'matches.forYourRequest', {
                title: cleanDisplayTitle(match.myListingTitle),
              })}
            </Text>
          </View>
          <Chip
            variant="tag"
            size="sm"
            label={t('matches.score', { pct: scorePercent(match.score) })}
            testID={`match-score-${match.candidateId}`}
          />
        </View>
      </TouchableOpacity>
      <View style={styles.bottomRow}>
        <Text style={styles.stateText} numberOfLines={1}>
          {t(`matches.state.${state}`)}
          {match.distanceKm != null
            ? ` · ${t('matches.distanceKm', { km: Math.round(match.distanceKm) })}`
            : ''}
        </Text>
        <View style={styles.actions}>
          {canRespond ? (
            <>
              <TouchableOpacity
                style={[styles.actionBtn, styles.declineBtn]}
                disabled={busy}
                onPress={() => onRespond(match.candidateId, 'decline')}
                accessibilityRole="button"
                accessibilityLabel={t('matches.decline')}
                testID={`match-decline-${match.candidateId}`}
              >
                <Ionicons name="close" size={iconSize.md} color={colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.acceptBtn]}
                disabled={busy}
                onPress={() => onRespond(match.candidateId, 'accept')}
                accessibilityRole="button"
                accessibilityLabel={t('matches.accept')}
                testID={`match-accept-${match.candidateId}`}
              >
                <Ionicons name="checkmark" size={iconSize.md} color={colors.textInverse} />
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity onPress={openListing} style={styles.viewLink} accessibilityRole="button">
              <Text style={styles.viewLinkText}>{t('matches.viewListing')}</Text>
              <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.primary} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Card>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  card: {
    borderWidth: 1,
    borderColor: colors.primaryLight,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  topRow: {
    flexDirection: rowDirectionStart,
    alignItems: 'flex-start' as const,
    gap: spacing.sm,
  },
  textCol: { flex: 1, gap: spacing.xs },
  title: { ...typography.bodySmall, ...typography.bold, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  meta: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  bottomRow: {
    flexDirection: rowDirectionStart,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: spacing.sm,
  },
  stateText: { ...typography.caption, color: colors.textSecondary, flex: 1, textAlign: rtlTextAlignStart },
  actions: { flexDirection: rowDirectionStart, alignItems: 'center' as const, gap: spacing.xs },
  actionBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  acceptBtn: { backgroundColor: colors.primary },
  declineBtn: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  viewLink: { flexDirection: rowDirectionStart, alignItems: 'center' as const, gap: 2 },
  viewLinkText: { ...typography.caption, ...typography.bold, color: colors.primary },
}));
