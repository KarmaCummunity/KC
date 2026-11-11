import React from 'react';
import { useTranslation } from 'react-i18next';
import { KcFlashList } from '../lists/KcFlashList';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { spacing, Text } from '@kc/ui';
import { Screen } from '../ui/Screen';
import { KcRowCard } from '../cards/KcRowCard';
import { listingWorldIcon } from '../cards/ListingCard';
import { cleanDisplayTitle } from '../../lib/displayTitle';
import { givingHandoffUseCases } from '../../services/givingHandoffComposition';
import { WorldSubScreenChrome } from './useWorldHeader';

const ROW = { marginHorizontal: spacing.lg };

/** My handoffs (as owner or recipient) for one giving world. */
export function MyWorldHandoffsList({
  worldSlug,
}: {
  readonly worldSlug: 'items' | 'food' | 'rides' | 'knowledge' | 'housing' | 'time' | 'animals';
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const rows = useQuery({
    queryKey: ['giving-handoffs', worldSlug],
    queryFn: async () => {
      const all = await givingHandoffUseCases.listMine().execute(50);
      return all.filter((r) => r.worldSlug === worldSlug);
    },
  });

  return (
    <>
      <WorldSubScreenChrome worldSlug={worldSlug} activeScreenTestId="world-hub-my-handoffs" />
      <Screen blobs="off" hasNativeHeader>
      <KcFlashList
        data={rows.data ?? []}
        keyExtractor={(item) => item.handoffId}
        contentContainerStyle={{ paddingVertical: spacing.md }}
        ListEmptyComponent={<Text style={{ padding: spacing.lg, textAlign: 'center' }}>—</Text>}
        renderItem={({ item }) => (
          <KcRowCard
            testID={`handoff-row-${item.handoffId}`}
            containerStyle={ROW}
            tone={item.role === 'owner' ? 'give' : 'request'}
            badgeLabel={t(`marketplace.world.${item.worldSlug}`, { defaultValue: item.worldSlug })}
            placeholderIcon={listingWorldIcon(item.worldSlug)}
            title={cleanDisplayTitle(item.title)}
            meta={[item.role]}
            statusLabel={t(`givingHandoff.statusLabel.${item.status}`, { defaultValue: item.status })}
            onPress={() => router.push(`/(tabs)/donations/marketplace/${item.listingId}`)}
          />
        )}
      />
      </Screen>
    </>
  );
}
