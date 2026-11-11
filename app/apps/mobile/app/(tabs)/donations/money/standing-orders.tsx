import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { KcFlashList } from '../../../../src/components/lists/KcFlashList';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import { Screen } from '../../../../src/components/ui/Screen';
import { paymentsUseCases } from '../../../../src/services/paymentsComposition';
import { shekelsText } from '../../../../src/components/money/moneyAmount';
import { listOrEmpty } from '../../../../src/lib/backendAvailability';

const useStyles = makeUseStyles(({ colors }) => ({
  row: { padding: spacing.lg, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { ...typography.bodyLarge, color: colors.textPrimary },
  meta: { ...typography.caption, color: colors.textSecondary },
  actions: { flexDirection: 'row' as const, gap: spacing.sm, flexWrap: 'wrap' as const },
  btn: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised },
  btnText: { ...typography.caption, ...typography.semiBold, color: colors.textPrimary },
}));

export default function MyStandingOrdersScreen() {
  const { t } = useTranslation();
  const styles = useStyles();
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const orders = useQuery({
    queryKey: ['money', 'standing-orders'],
    queryFn: () => listOrEmpty(() => paymentsUseCases.listStandingOrders().execute()),
  });

  async function act(orderId: string, fn: () => Promise<void>) {
    setBusyId(orderId);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['money', 'standing-orders'] });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Screen>
      <KcFlashList
        data={orders.data ?? []}
        keyExtractor={(item) => item.orderId}
        ListEmptyComponent={
          <Text style={{ padding: spacing.lg, textAlign: 'center' }}>
            {orders.isLoading ? t('moneyPayments.loading') : t('moneyPayments.standingEmpty')}
          </Text>
        }
        renderItem={({ item }) => {
          const busy = busyId === item.orderId;
          return (
            <View style={styles.row}>
              <Text style={styles.title}>
                ₪{shekelsText(item.amountAgorot)} / {t('moneyPayments.monthlyCadence')}
              </Text>
              <Text style={styles.meta}>
                {t('moneyPayments.standingStatus', { status: item.status })}
                {item.nextChargeAt
                  ? ` · ${t('moneyPayments.nextCharge', { date: new Date(item.nextChargeAt).toLocaleDateString() })}`
                  : ''}
              </Text>
              <View style={styles.actions}>
                {item.status === 'active' ? (
                  <Pressable
                    style={styles.btn}
                    disabled={busy}
                    onPress={() => void act(item.orderId, () => paymentsUseCases.pauseStandingOrder().execute(item.orderId))}
                  >
                    <Text style={styles.btnText}>{t('moneyPayments.pauseStanding')}</Text>
                  </Pressable>
                ) : null}
                {item.status === 'paused' ? (
                  <Pressable
                    style={styles.btn}
                    disabled={busy}
                    onPress={() => void act(item.orderId, () => paymentsUseCases.resumeStandingOrder().execute(item.orderId))}
                  >
                    <Text style={styles.btnText}>{t('moneyPayments.resumeStanding')}</Text>
                  </Pressable>
                ) : null}
                {item.status !== 'cancelled' ? (
                  <Pressable
                    style={styles.btn}
                    disabled={busy}
                    onPress={() => void act(item.orderId, () => paymentsUseCases.cancelStandingOrder().execute(item.orderId))}
                  >
                    <Text style={styles.btnText}>{t('moneyPayments.cancelStanding')}</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          );
        }}
      />
    </Screen>
  );
}
