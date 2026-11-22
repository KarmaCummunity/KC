import React from 'react';
import { Linking } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AmountCheckoutScreen } from '../../../../../src/components/money/AmountCheckoutForm';
import { toAgorot } from '../../../../../src/components/money/moneyAmount';
import { newIdempotencyKey, paymentsUseCases } from '../../../../../src/services/paymentsComposition';
import { notAvailableMessage, runAction } from '../../../../../src/lib/backendAvailability';
import { track } from '../../../../../src/lib/analytics';
import { InAppOrgPaymentsGate } from '../../../../../src/components/money/InAppOrgPaymentsGate';

const PRESETS = [36, 72, 180, 360] as const;

/**
 * One-time donation (FR-DONATE-011): the app starts an intent and sends the member to the payment
 * provider's page; the donation settles when the provider confirms it to the server and then
 * appears in the history with its receipt. Until the payment service gives the intent a checkout
 * page, the member is told the donation is not available yet.
 */
function DonateNowScreen() {
  const { orgId, listingId } = useLocalSearchParams<{ orgId: string; listingId?: string }>();
  const { t } = useTranslation();
  const router = useRouter();

  const donate = async (shekels: number) => {
    const outcome = await runAction(() =>
      paymentsUseCases.donateNow().execute({
        orgId: orgId!,
        amountAgorot: toAgorot(shekels),
        idempotencyKey: newIdempotencyKey('donate'),
        postId: listingId ?? null,
      }),
    );
    const checkoutUrl = outcome.status === 'done' ? outcome.value.checkoutUrl : null;
    if (!checkoutUrl) {
      alert(notAvailableMessage());
      return;
    }
    track('donation', { channel: 'money' });
    await Linking.openURL(checkoutUrl);
    router.replace('/(tabs)/donations/money/history');
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

/** The screen behind the sandbox flag (FR-DONATE-003 AC7): a direct link with it off lands on the hub. */
export default function DonateNowScreenRoute() {
  return (
    <InAppOrgPaymentsGate>
      <DonateNowScreen />
    </InAppOrgPaymentsGate>
  );
}
