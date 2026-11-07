// One "Matches for you" row (matching v2) rendered with the shared base post card (KcCard):
// counterpart listing + match % / state chip in the status slot, accept/decline in the footer slot.
import React from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing } from '@kc/ui';
import { View } from 'react-native';
import { rowDirectionStart } from '../../lib/rtlLayout';
import type { MatchSuggestion } from '@kc/infrastructure-supabase';
import { KcCard } from '../cards/KcCard';
import { listingWorldIcon } from '../cards/ListingCard';
import { GhostButton, PrimaryButton, SecondaryButton } from '../ui/Buttons';
import { useShellContentWidth } from '../../hooks/useShellContentWidth';
import { cleanDisplayTitle } from '../../lib/displayTitle';
import { matchStateOf, scorePercent } from '../../lib/matching';

interface Props {
  readonly match: MatchSuggestion;
  readonly busy?: boolean;
  readonly onRespond: (candidateId: string, response: 'accept' | 'decline') => void;
}

const WIDE_IMAGE_RATIO = 0.28;

export function MatchSuggestionCard({ match, busy, onRespond }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const footerStyles = useMatchCardFooterStyles();
  const width = useShellContentWidth() - spacing.base * 2;
  const state = matchStateOf(match);
  const owner = match.otherOwner.displayName ?? t('matches.someone');
  // The counterpart is the opposite side of my listing.
  const otherIsRequest = match.myRole === 'offer';
  const openListing = () =>
    router.push({ pathname: '/listing/[listingId]', params: { listingId: match.otherListingId } });
  const canRespond = state === 'new' || state === 'theyAccepted';
  const details: Array<{ icon: React.ComponentProps<typeof KcCard>['placeholderIcon']; text: string }> = [
    { icon: 'link-outline', text: t(match.myRole === 'offer' ? 'matches.forYourOffer' : 'matches.forYourRequest', { title: cleanDisplayTitle(match.myListingTitle) }) },
  ];
  if (match.reason) details.push({ icon: 'information-circle-outline', text: match.reason });

  return (
    <KcCard
      testID={`match-card-${match.candidateId}`}
      width={width}
      imageRatio={WIDE_IMAGE_RATIO}
      onPress={openListing}
      accessibilityLabel={cleanDisplayTitle(match.otherListingTitle)}
      placeholderIcon={listingWorldIcon(match.worldSlug)}
      tone={otherIsRequest ? 'request' : 'give'}
      badgeLabel={t(otherIsRequest ? 'feed.requestTypeShort' : 'feed.giveTypeShort')}
      statusLabel={`${t(`matches.state.${state}`)} · ${t('matches.score', { pct: scorePercent(match.score) })}`}
      author={{ name: owner, avatarUrl: match.otherOwner.avatarUrl }}
      title={cleanDisplayTitle(match.otherListingTitle)}
      chip={t(`marketplace.world.${match.worldSlug}`, { defaultValue: match.worldSlug })}
      details={details}
      location={match.distanceKm == null ? null : t('matches.distanceKm', { km: Math.round(match.distanceKm) })}
      footer={(
        <View style={footerStyles.wrap}>
          {canRespond ? (
            <View style={footerStyles.actionRow}>
              <View style={footerStyles.actionCell}>
                <SecondaryButton
                  size="md"
                  fullWidth
                  label={t('matches.decline')}
                  disabled={busy}
                  onPress={() => onRespond(match.candidateId, 'decline')}
                  testID={`match-decline-${match.candidateId}`}
                />
              </View>
              <View style={footerStyles.actionCell}>
                <PrimaryButton
                  size="md"
                  fullWidth
                  label={t('matches.accept')}
                  loading={busy}
                  onPress={() => onRespond(match.candidateId, 'accept')}
                  testID={`match-accept-${match.candidateId}`}
                />
              </View>
            </View>
          ) : null}
          <GhostButton
            size="sm"
            fullWidth
            label={t('matches.viewListing')}
            onPress={openListing}
          />
        </View>
      )}
    />
  );
}

const useMatchCardFooterStyles = makeUseStyles(() => ({
  wrap: { width: '100%', alignSelf: 'stretch' as const, gap: spacing.sm },
  actionRow: {
    width: '100%',
    flexDirection: rowDirectionStart,
    alignItems: 'stretch' as const,
    gap: spacing.sm,
  },
  actionCell: { flex: 1, minWidth: 0 },
}));
