// FR-HOUSING-037 — the guest's own stays in one list.
import React from 'react';
import { Pressable, View } from 'react-native';
import { KcFlashList } from '../../lists/KcFlashList';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import type { HousingGuestStay } from '@kc/domain';
import { Screen } from '../../ui/Screen';
import { EmptyState } from '../../EmptyState';
import { housingQueryKeys, housingUseCases } from '../../../services/housingComposition';
import { rtlTextAlignStart } from '../../../lib/rtlTextAlignStart';
import { WorldSubScreenChrome } from '../../giving/useWorldHeader';
import { listOrEmpty } from '../../../lib/backendAvailability';

export function HousingMyStaysScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useStyles();
  const stays = useQuery({
    queryKey: housingQueryKeys.myStays,
    queryFn: () => listOrEmpty(() => housingUseCases.listMyStays().execute()),
  });

  return (
    <>
      <WorldSubScreenChrome worldSlug="housing" activeScreenTestId="world-hub-housing-stays" />
      <Screen blobs="off" hasNativeHeader testID="housing-my-stays">
      <KcFlashList
        data={stays.data ?? []}
        keyExtractor={(item) => item.handoffId}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          stays.isSuccess ? (
            <EmptyState icon="bed-outline" title={t('housingStay.myStays.empty')} />
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            style={styles.row}
            onPress={() => router.push(`/listing/${item.listingId}`)}
            testID={`housing-stay-row-${item.handoffId}`}
          >
            <StayRow stay={item} />
          </Pressable>
        )}
      />
      </Screen>
    </>
  );
}

function StayRow({ stay }: { readonly stay: HousingGuestStay }) {
  const { t } = useTranslation();
  const styles = useStyles();
  return (
    <View>
      <Text style={styles.title}>{stay.listingTitle}</Text>
      <Text style={styles.meta}>
        {t('housingStay.stayDates', { from: stay.checkInDate, to: stay.checkOutDate })}
        {' · '}
        {t(`housingStay.statusLabel.${stay.status}`)}
      </Text>
      <Text style={styles.host}>{stay.hostName}</Text>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  list: { padding: spacing.base, gap: spacing.md, flexGrow: 1 },
  row: {
    padding: spacing.base,
    borderRadius: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  title: { ...typography.h3, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  meta: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart, marginTop: spacing.xs },
  host: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart, marginTop: spacing.xs },
}));
