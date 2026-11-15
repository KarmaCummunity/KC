// FR-HOUSING-036 — the host's housing offers and how many bookings are waiting.
import React, { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { KcFlashList } from '../../lists/KcFlashList';
import { useRouter } from 'expo-router';
import { useQueries } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import type { MyListingRow } from '@kc/domain';
import { Screen } from '../../ui/Screen';
import { EmptyState } from '../../EmptyState';
import { useMyMarketplaceListings } from '../../../hooks/useMyMarketplaceListings';
import { housingQueryKeys, housingUseCases } from '../../../services/housingComposition';
import { rtlTextAlignStart } from '../../../lib/rtlTextAlignStart';
import { WorldSubScreenChrome } from '../../giving/useWorldHeader';
import { listOrEmpty } from '../../../lib/backendAvailability';

export function HousingMyHostingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useStyles();
  const pages = useMyMarketplaceListings();
  const offers = useMemo(
    () =>
      (pages.data?.pages ?? [])
        .flatMap((p) => p.rows)
        .filter((row) => row.worldSlug === 'housing' && row.direction === 'give'),
    [pages.data?.pages],
  );

  const pending = useQueries({
    queries: offers.map((offer) => ({
      queryKey: housingQueryKeys.offerBookings(offer.listingId),
      queryFn: () => listOrEmpty(() => housingUseCases.listForOffer().execute(offer.listingId)),
      staleTime: 30_000,
    })),
  });

  const pendingById = useMemo(() => {
    const map = new Map<string, number>();
    offers.forEach((offer, index) => {
      const count = (pending[index]?.data ?? []).filter((b) => b.status === 'reserved').length;
      map.set(offer.listingId, count);
    });
    return map;
  }, [offers, pending]);

  return (
    <>
      <WorldSubScreenChrome worldSlug="housing" activeScreenTestId="world-hub-housing-hosting" />
      <Screen blobs="off" hasNativeHeader testID="housing-my-hosting">
      <KcFlashList
        data={offers}
        keyExtractor={(item) => item.listingId}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          pages.isSuccess ? <EmptyState icon="home-outline" title={t('housingStay.myHosting.empty')} /> : null
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            style={styles.row}
            onPress={() => router.push(`/listing/${item.listingId}`)}
            testID={`housing-offer-row-${item.listingId}`}
          >
            <OfferRow offer={item} pending={pendingById.get(item.listingId) ?? 0} />
          </Pressable>
        )}
      />
      </Screen>
    </>
  );
}

function OfferRow({ offer, pending }: { readonly offer: MyListingRow; readonly pending: number }) {
  const { t } = useTranslation();
  const styles = useStyles();
  return (
    <View>
      <Text style={styles.title}>{offer.title}</Text>
      <Text style={styles.meta}>{t(`marketplace.myListings.status.${offer.availabilityStatus}`, { defaultValue: offer.status })}</Text>
      {pending > 0 ? (
        <Text style={styles.badge}>{t('housingStay.myHosting.pending', { count: pending })}</Text>
      ) : null}
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
  badge: { ...typography.body, color: colors.primary, textAlign: rtlTextAlignStart, marginTop: spacing.xs },
}));
