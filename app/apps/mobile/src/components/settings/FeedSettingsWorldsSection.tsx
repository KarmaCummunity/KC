// Mute entire giving worlds from the home feed (filter_kind = world, slug in feed_mute_filters).
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GIVING_WORLD_SLUGS, type GivingWorldSlug } from '@kc/domain';
import { makeUseStyles, spacing } from '@kc/ui';
import { Chip } from '../ui';
import { FeedSettingsSection } from './FeedSettingsSection';
import { findWorldMute, type MuteFilter } from '../../lib/feedMuteFilters';
import { rowDirectionStart } from '../../lib/rtlLayout';
import { webViewRtl } from '../../lib/webRtlStyle';

function worldTitleKey(world: GivingWorldSlug): string {
  if (world === 'items') return 'donations.items.title';
  if (world === 'rides') return 'donations.rides.hubTitle';
  if (world === 'time') return 'donations.time.title';
  if (world === 'money') return 'donations.money.title';
  return `donations.categories.${world}.title`;
}

export function FeedSettingsWorldsSection({
  rows,
  onAdd,
  onRemove,
}: {
  readonly rows: readonly MuteFilter[];
  readonly onAdd: (world: GivingWorldSlug) => void;
  readonly onRemove: (filterId: string) => void;
}) {
  const { t } = useTranslation();
  const styles = useStyles();
  return (
    <FeedSettingsSection title={t('feedSettings.worldsTitle')} hint={t('feedSettings.worldsHint')}>
      <View style={styles.chips}>
        {GIVING_WORLD_SLUGS.map((world) => {
          const muted = findWorldMute(rows, world);
          return (
            <Chip
              key={world}
              selected={Boolean(muted)}
              onPress={() => (muted ? onRemove(muted.filterId) : onAdd(world))}
              label={t(worldTitleKey(world))}
              icon={muted ? 'eye-off-outline' : undefined}
              testID={`feed-settings-world-${world}`}
            />
          );
        })}
      </View>
    </FeedSettingsSection>
  );
}

const useStyles = makeUseStyles(() => ({
  chips: {
    flexDirection: rowDirectionStart,
    flexWrap: 'wrap' as const,
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.base,
    ...webViewRtl,
  },
}));
