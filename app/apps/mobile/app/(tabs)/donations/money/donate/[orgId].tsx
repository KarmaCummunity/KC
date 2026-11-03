import React from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AmountCheckoutScreen } from '../../../../../src/components/money/AmountCheckoutForm';
import { newIdempotencyKey, paymentsUseCases } from '../../../../../src/services/paymentsComposition';
import { track } from '../../../../../src/lib/analytics';

const PRESETS = [36, 72, 180, 360] as const;

export default function DonateNowScreen() {
  const { orgId, listingId } = useLocalSearchParams<{ orgId: string; listingId?: string }>();
  const { t } = useTranslation();
  const router = useRouter();

  const donate = async (amountIls: number) => {
    const checkout = await paymentsUseCases.donateNow().execute({
      orgId: orgId!,
      amountIls,
      idempotencyKey: newIdempotencyKey('donate'),
      listingId: listingId ?? null,
    });
    const done = await paymentsUseCases.confirmDonation().execute(checkout.intentId);
    track('donation', { channel: 'money' });
    router.replace({
      pathname: '/(tabs)/donations/money/receipt/[paymentId]',
      params: { paymentId: done.paymentId },
    });
  };

  return (
    <AmountCheckoutScreen
      kind="donate"
      orgId={orgId}
      listingId={listingId}
      amountLabel={t('moneyPayments.amountLabel')}
      initialAmount="72"
      presets={PRESETS}
      note={t('moneyPayments.sandboxBanner')}
      submitLabel={t('moneyPayments.confirmDonate')}
      onSubmit={donate}
    />
  );
}
