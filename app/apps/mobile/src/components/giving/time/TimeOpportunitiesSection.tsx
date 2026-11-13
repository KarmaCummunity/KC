// Mapped to spec: FR-FEED-020 AC2 (the time world's own sub-screens and content) · FR-DONATE
// time volunteering — organisations' open volunteering opportunities on the time world screen,
// above the members' time listings. A short preview expands in place to the whole list.
import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { KcRowCard } from '../../cards/KcRowCard';
import { GhostButton } from '../../ui/Buttons';
import { volunteerUseCases } from '../../../services/volunteerComposition';

/** Opportunities shown before "all volunteering" expands the section. */
export const TIME_OPPORTUNITIES_PREVIEW = 3;
/** Opportunities loaded for the section (the former hub's page size). */
const TIME_OPPORTUNITIES_LIMIT = 40;

const useStyles = makeUseStyles(({ colors }) => ({
  root: { gap: spacing.sm, marginTop: spacing.lg },
  title: { ...typography.h3, color: colors.textPrimary, paddingHorizontal: spacing.lg },
  row: { marginHorizontal: spacing.lg },
  toggle: { paddingHorizontal: spacing.lg },
}));

/** Localised "date · time" of a shift start; the raw value if it cannot be formatted. */
export function formatShiftStart(iso: string | null, language: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(language.startsWith('he') ? 'he-IL' : 'en-IL', { dateStyle: 'medium', timeStyle: 'short' });
}

export function TimeOpportunitiesSection() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const styles = useStyles();
  const [expanded, setExpanded] = useState(false);
  const opportunities = useQuery({
    queryKey: ['volunteer', 'browse'],
    queryFn: () => volunteerUseCases.listOpportunities().execute(TIME_OPPORTUNITIES_LIMIT),
    staleTime: 30_000,
  });
  const all = opportunities.data ?? [];
  // Nothing to show (still loading, or no organisation recruits now): the world feed follows.
  if (all.length === 0) return null;
  const visible = expanded ? all : all.slice(0, TIME_OPPORTUNITIES_PREVIEW);

  return (
    <View style={styles.root} testID="time-opportunities">
      <Text style={styles.title}>{t('donations.worldFeed.timeOpportunitiesTitle')}</Text>
      {visible.map((item) => (
        <KcRowCard
          key={item.opportunityId}
          testID={`opportunity-row-${item.opportunityId}`}
          containerStyle={styles.row}
          tone="give"
          badgeLabel={t('marketplace.world.time', { defaultValue: 'time' })}
          placeholderIcon="time-outline"
          title={item.title}
          meta={[
            item.locationLabel,
            `${t('timeVolunteer.slotsOpen', { count: item.openSlots })}${
              item.nextShiftAt
                ? ` · ${t('timeVolunteer.nextShift', { date: formatShiftStart(item.nextShiftAt, i18n.language) })}`
                : ''
            }`,
          ]}
          onPress={() =>
            router.push({
              pathname: '/(tabs)/donations/time/opportunity/[opportunityId]',
              params: { opportunityId: item.opportunityId },
            })
          }
        />
      ))}
      {all.length > TIME_OPPORTUNITIES_PREVIEW ? (
        <View style={styles.toggle}>
          <GhostButton
            testID="time-opportunities-toggle"
            size="sm"
            label={
              expanded
                ? t('donations.worldFeed.timeOpportunitiesShowLess')
                : t('donations.worldFeed.timeOpportunitiesShowAll', { count: all.length })
            }
            onPress={() => setExpanded((open) => !open)}
          />
        </View>
      ) : null}
    </View>
  );
}
